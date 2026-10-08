import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import { getSettingsStrict } from "@/core/settings/settings";
import { limitsFor, parseDaily, today } from "@/core/consultant/budget";
import { loadPricelist } from "@/core/consultant/pricelist/catalog.server";
import { loadKnowledge } from "@/core/consultant/pricelist/knowledge.server";
import { getStoredRateStrict } from "@/core/consultant/pricelist/rate.server";
import { isRateFresh } from "@/core/consultant/pricelist/rate";
import { loadSheetLink } from "@/core/consultant/pricelist/sheet.server";
import { isConsultantVertical } from "@/core/verticals/registry";
import {
  dayStats,
  journalEntries,
  weekTotal,
  lastLocalDays,
  workspaceAlerts,
  type JournalRow,
} from "@/core/consultant/journal";
import { zonedDayToUtc } from "@/core/export/csv";
import { consultantTasks, requirePricelist } from "./pricelist.server";

/**
 * Рабочее место консультанта без продаж (BOVI): «Обзор» — сегодня и неделя по
 * журналу ответов, открытые задачи, расход и предупреждения; журнал ответов
 * по диалогу. Только чтение; каждый сбой чтения — ошибка, а не «пусто».
 */

/** Ключи app_settings консультанта (core/consultant/engine.server KEYS). */
const ENABLED_KEY = "consultant_enabled";
const DAILY_KEY = "consultant_daily";
const LAST_ERROR_KEY = "consultant_last_error";

/** Сколько открытых задач видно на «Обзоре» (все — на странице «Задачи»). */
export const OVERVIEW_TASKS = 3;

export async function consultantOverview(
  ctx: TenantContext,
  opts: { contacts: boolean },
  now = new Date(),
) {
  requirePricelist(ctx);
  const days = lastLocalDays(now, ctx.timezone, 7);
  const since = zonedDayToUtc(days[0]!, ctx.timezone);
  const [rows, s, snap, rate, sheet, articles, tasks] = await Promise.all([
    pageAll(
      (from, to) =>
        ctx.db
          .from("consultant_message_runs")
          .select("id, conversation_id, status, reply_kind, received_at, token_usage")
          .gte("received_at", since)
          .order("received_at")
          .order("id")
          .range(from, to),
      "журнал ответов консультанта",
    ),
    getSettingsStrict(ctx, [ENABLED_KEY, DAILY_KEY, LAST_ERROR_KEY]),
    loadPricelist(ctx),
    // Сбой чтения курса — ошибка «Обзора», а не ложное «курса нет».
    getStoredRateStrict(ctx),
    loadSheetLink(ctx),
    loadKnowledge(ctx),
    opts.contacts ? consultantTasks(ctx) : Promise.resolve(null),
  ]);
  const week = dayStats(rows, ctx.timezone, days);
  const weekSum = weekTotal(rows, ctx.timezone, days);
  // Дневной предел считается по суткам UTC (core/consultant/budget).
  const daily = parseDaily(s[DAILY_KEY], today(now));
  const limitUsd = limitsFor(ctx.tenant.settings.consultant_limits).dailyUsd;
  const enabledRaw = s[ENABLED_KEY];
  const enabled =
    enabledRaw === "true" || (enabledRaw !== "false" && isConsultantVertical(ctx.tenant.vertical));
  const sheetOk = sheet?.status?.lastOkAt ?? null;
  const fileAt = snap.meta?.importedAt ?? null;
  const pricelistAt = [sheetOk, fileAt].filter(Boolean).sort().at(-1) ?? null;
  const open = tasks ? tasks.tasks.filter((t) => !t.done) : [];
  return {
    enabled,
    today: week.at(-1)!,
    week,
    weekTotal: weekSum,
    spend: { usd: daily.usd, limitUsd },
    tasks: tasks ? { open: tasks.open, top: open.slice(0, OVERVIEW_TASKS) } : null,
    pricelist: { count: snap.products.length, at: pricelistAt },
    rate: rate ? { rate: rate.rate, updatedAt: rate.updatedAt, fresh: isRateFresh(rate) } : null,
    alerts: workspaceAlerts(
      {
        enabled,
        pricelistCount: snap.products.length,
        pricelistAt,
        sheetFailing: Boolean(sheet?.status && !sheet.status.ok),
        rate: rate ? { fresh: isRateFresh(rate) } : null,
        spentUsd: daily.usd,
        limitUsd,
        lastError: s[LAST_ERROR_KEY] ?? "",
        chatOn: Boolean(ctx.tenant.modules.manager_chat),
        untaggedArticles: articles.filter((a) => a.tags.length === 0).length,
      },
      now.getTime(),
    ),
  };
}

/** Строк журнала на страницу. */
export const JOURNAL_PAGE = 20;

/**
 * Журнал ответов консультанта по одному покупателю, свежие сверху, страницами:
 * вопрос → ответ → замечания проверки → передал или промолчал.
 */
export async function consultantJournal(ctx: TenantContext, userKey: string, offset = 0) {
  requirePricelist(ctx);
  const { data, error } = await ctx.db
    .from("consultant_message_runs")
    .select("id, conversation_id, status, incoming_text, reply_text, reply_kind, received_at")
    .eq("user_key", userKey)
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    // Строкой больше страницы — узнать, есть ли ещё (ничего не теряется: следующая страница).
    .range(offset, offset + JOURNAL_PAGE);
  if (error) throw serverFailure(`журнал ответов консультанта: ${error.message}`);
  const rows = (data ?? []) as JournalRow[];
  const page = rows.slice(0, JOURNAL_PAGE);
  const snap = await loadPricelist(ctx);
  return {
    entries: journalEntries(page, snap.products),
    hasMore: rows.length > JOURNAL_PAGE,
    next: offset + page.length,
  };
}
