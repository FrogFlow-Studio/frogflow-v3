import type { Tenant } from "@/core/tenant/types";
import { tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { claimStateSection, customerFromRow, updateStateSection } from "@/core/customers/customers";
import { getSetting, getSettings, updateSettingAtomic } from "@/core/settings/settings";
import {
  buildQualityDigest,
  DIGEST_HOUR,
  DIGEST_SENT_KEY,
  DIGEST_SETTING_KEY,
  previousLocalDay,
  type DigestRun,
} from "@/core/consultant/pricelist/quality-digest";
import { escapeHtml } from "@/channels/telegram/copy";
import { pricelistMode, isOffHours, pricelistHours } from "@/core/consultant/pricelist/mode";
import { loadPricelist } from "@/core/consultant/pricelist/catalog.server";
import { refreshRate } from "@/core/consultant/pricelist/rate.server";
import { refreshPricelistSheet } from "@/core/consultant/pricelist/sheet.server";
import type { FetchLike } from "@/core/catalog/sheet.server";
import {
  buyerWindow,
  FOLLOW_UP_SETTING_KEY,
  FOLLOW_UP_UNTIL_MS,
  followUpEnabled,
  followUpText,
  isFollowUpCandidate,
  recentWithFollowUp,
  type FollowUpState,
} from "@/core/consultant/pricelist/follow-up";
import { liveTransport, type ZernioTransport } from "./api.server";
import { findManagerMessage } from "./manager-guard";
import type { ZernioPlatform } from "./platform";
import { pageAll } from "@/core/db/page";
import { buyerLocale } from "@/core/consultant/messages";
import { loadTasks } from "@/core/consultant/tasks";
import type { ZernioInboxMessage } from "./inbox-types";

/**
 * Фоновые задачи консультанта по прайсу (крон health, раз в 15 минут, как
 * кроны v1): свежий курс рубля (шаг 18), прайс из подключённой Google
 * Таблицы (как refreshCatalogFromSavedSheet v1) и одно напоминание
 * замолчавшему покупателю в директе (шаг 16). Только клиенты v2 с режимом
 * «по прайсу» — список уже отобран маршрутом крона.
 */
const MAX_FOLLOW_UPS_PER_RUN = 20;
/** Общий предел на скачивание таблицы одного магазина (со всеми переадресациями). */
export const SHEET_REFRESH_BUDGET_MS = 25_000;

/** fetch с общим сроком: тайм-аут каждого запроса и общий предел — что наступит раньше. */
export function fetchWithin(ms: number, base: FetchLike = fetch): FetchLike {
  const deadline = AbortSignal.timeout(ms);
  return (url, init) =>
    base(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
    });
}

export async function runPricelistJobs(
  tenants: Tenant[],
  now = new Date(),
  transport: ZernioTransport = liveTransport,
  sheetFetch?: FetchLike,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const t of tenants) {
    if (!pricelistMode(t)) continue;
    const ctx = tenantContext(t);
    try {
      const rate = await refreshRate(ctx);
      // Таблица не скачалась или база отказала — прайс не тронут, остальные задачи идут.
      const sheet = await refreshPricelistSheet(
        ctx,
        now,
        sheetFetch ?? fetchWithin(SHEET_REFRESH_BUDGET_MS),
      ).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      const followUps = await sendPricelistFollowUps(ctx, now, transport);
      const digest = await sendQualityDigest(ctx, now);
      out[t.id] = {
        rate: rate.fetched ? rate.stored?.rate : (rate.error ?? "kept"),
        sheet,
        followUps,
        digest,
      };
    } catch (e) {
      out[t.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

type FollowUpRun = {
  checked: number;
  sent: number;
  skipped?: string;
  manager?: number;
  /** Окно канала закрыто или не проверить: последнее сообщение покупателя старше 23 ч. */
  window?: number;
  /** По покупателю открыта задача продавцу — он ведёт диалог сам. */
  task?: number;
};

export async function sendPricelistFollowUps(
  ctx: TenantContext,
  now = new Date(),
  transport: ZernioTransport = liveTransport,
): Promise<FollowUpRun> {
  if (!followUpEnabled(await getSetting(ctx, FOLLOW_UP_SETTING_KEY)))
    return { checked: 0, sent: 0, skipped: "off" };
  if (isOffHours(now, pricelistHours(ctx.tenant), ctx.timezone))
    return { checked: 0, sent: 0, skipped: "off_hours" };
  const since = new Date(now.getTime() - FOLLOW_UP_UNTIL_MS - 3600_000).toISOString();
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("*")
        .gte("updated_at", since)
        .not("zernio_conversation_id", "is", null)
        .order("updated_at", { ascending: false })
        .order("user_key")
        .range(from, to),
    "[consultant] диалоги не прочитаны",
  );
  const memoryOf = (state: unknown): FollowUpState => {
    const c = (state as { consultant?: unknown } | null)?.consultant;
    return c && typeof c === "object" && !Array.isArray(c) ? (c as FollowUpState) : {};
  };
  const candidates = rows
    .map(customerFromRow)
    .filter((c) => c.zernioConversationId && c.zernioAccountId)
    .filter((c) => isFollowUpCandidate(memoryOf(c.state), now, false))
    .slice(0, MAX_FOLLOW_UPS_PER_RUN);
  if (!candidates.length) return { checked: rows.length, sent: 0 };

  // Открытая задача — покупатель ждёт продавца. Список не прочитался — не знаем,
  // кого он ведёт: в этот раз никому не пишем (loadTasks бросает, а не «задач нет»).
  let openTaskUsers: Set<string>;
  try {
    openTaskUsers = new Set((await loadTasks(ctx)).filter((t) => !t.done).map((t) => t.userKey));
  } catch (e) {
    console.warn(`[followup:${ctx.tenant.id}] задачи не прочитаны: ${String(e)}`);
    return { checked: rows.length, sent: 0, skipped: "tasks_unreadable" };
  }

  const { products } = await loadPricelist(ctx);
  let sent = 0;
  let manager = 0;
  let window = 0;
  let task = 0;
  /** Отметка без отправки: этот ответ бота больше не смотрим. */
  const markOnly = (customer: (typeof candidates)[number], replyAt: string | undefined) =>
    claimStateSection(ctx, customer, "consultant", (cur) =>
      (cur.followup_for ?? cur.v2_followup_for) === replyAt
        ? null
        : { ...cur, followup_for: replyAt },
    );
  for (const customer of candidates) {
    const memory = memoryOf(customer.state);
    const text = followUpText(memory, products, buyerLocale(ctx, customer));
    if (text) {
      if (openTaskUsers.has(customer.userKey)) {
        await markOnly(customer, memory.last_reply_at);
        task++;
        continue;
      }
      // Переписку прочитать не удалось — не знаем, кто в чате и открыто ли окно:
      // ждём следующего крона.
      const tail = await readTail(customer, transport);
      if (!tail) continue;
      // Менеджер ответил из приложения после бота (Zernio исходящих не присылает,
      // паузы нет) — напоминание от бота поверх человека не шлём, диалог отмечаем.
      if (managerInChat(customer, memory, tail, now)) {
        await markOnly(customer, memory.last_reply_at);
        manager++;
        continue;
      }
      const w = buyerWindow(lastIncomingAt(tail), memory.last_reply_at, now);
      if (w === "not_silent") continue;
      if (w !== "open") {
        await markOnly(customer, memory.last_reply_at);
        window++;
        continue;
      }
    }
    // Сначала отметка и «свой голос», потом отправка: второй крон не повторит,
    // а проверка «в чате менеджер» узнает своё сообщение (relayed).
    // Отметка — условная по свежему состоянию: если соседний крон уже поставил
    // followup_for на эту реплику, claimStateSection вернёт null, и мы уступаем.
    const marked = await claimStateSection(ctx, customer, "consultant", (cur) =>
      (cur.followup_for ?? cur.v2_followup_for) === memory.last_reply_at
        ? null
        : {
            ...cur,
            followup_for: memory.last_reply_at,
            ...(text
              ? {
                  relayed: [...((cur.relayed as string[] | undefined) ?? []), text].slice(-10),
                }
              : {}),
          },
    );
    if (!marked) continue;
    // Писать нечего (товара нет в прайсе) — только отметка: диалог больше не смотрим.
    if (!text) continue;
    const r = await transport.send(
      customer.zernioConversationId!,
      customer.zernioAccountId!,
      text,
      {
        platform: customer.platform as ZernioPlatform,
        idempotencyScope: `followup:${customer.userKey}:${memory.last_reply_at}`,
      },
    );
    if (!r.ok) {
      console.warn(`[followup:${ctx.tenant.id}] ${customer.userKey}: ${r.error}`);
      continue;
    }
    await updateStateSection(ctx, marked, "consultant", (cur) => ({
      ...cur,
      recent: recentWithFollowUp(cur as FollowUpState, text),
    }));
    if (ctx.tenant.modules.manager_chat) {
      const { recordMessage } = await import("@/core/chat/chat");
      await recordMessage(ctx, {
        telegramId: customer.telegramId,
        direction: "out",
        sender: "bot",
        text,
      }).catch(() => {});
    }
    sent++;
  }
  return {
    checked: rows.length,
    sent,
    ...(manager ? { manager } : {}),
    ...(window ? { window } : {}),
    ...(task ? { task } : {}),
  };
}

/** Хвост переписки в Zernio; не прочитался — null. */
async function readTail(
  customer: ReturnType<typeof customerFromRow>,
  transport: ZernioTransport,
): Promise<ZernioInboxMessage[] | null> {
  try {
    return await transport.tail(customer.zernioAccountId!, customer.zernioConversationId!);
  } catch (e) {
    console.warn(`[followup] переписка ${customer.userKey} не прочитана: ${String(e)}`);
    return null;
  }
}

/** Время последнего входящего покупателя в ленте, мс; нет — null. */
export function lastIncomingAt(tail: ZernioInboxMessage[]): number | null {
  let last: number | null = null;
  for (const m of tail) {
    if (m.direction !== "incoming") continue;
    const at = Date.parse(m.createdAt ?? m.sentAt ?? "");
    if (Number.isFinite(at) && (last === null || at > last)) last = at;
  }
  return last;
}

/** В хвосте переписки есть ответ человека новее последнего ответа бота. */
function managerInChat(
  customer: ReturnType<typeof customerFromRow>,
  memory: FollowUpState,
  tail: ZernioInboxMessage[],
  now: Date,
): boolean {
  const c = (customer.state.consultant ?? {}) as { relayed?: unknown };
  const relayed = Array.isArray(c.relayed) ? c.relayed.map(String) : [];
  return Boolean(
    findManagerMessage(
      tail,
      {
        lastBotReplyAt: memory.last_reply_at,
        ourReplies: [
          ...(memory.recent ?? []).filter((t) => t.role === "assistant").map((t) => t.text),
          ...relayed,
        ],
      },
      now.getTime(),
    ),
  );
}

/**
 * Сводка качества за вчера (шаг 17): после 9:00 по поясу магазина, один раз
 * в сутки, если продавец включил. Отметка — до отправки: два крона подряд
 * не дадут две сводки.
 */
export async function sendQualityDigest(
  ctx: TenantContext,
  now = new Date(),
  notify: (ctx: TenantContext, html: string) => Promise<number> = async (c, html) =>
    (await import("@/channels/telegram/notify")).notifyAdminsHtml(c, html, { kind: "digest" }),
): Promise<{ sent: boolean; reason?: string }> {
  const s = await getSettings(ctx, [DIGEST_SETTING_KEY, DIGEST_SENT_KEY]);
  if (s[DIGEST_SETTING_KEY]?.trim() !== "on") return { sent: false, reason: "off" };
  const { day, from, to, hour } = previousLocalDay(now, ctx.timezone);
  if (hour < DIGEST_HOUR) return { sent: false, reason: "early" };
  if (s[DIGEST_SENT_KEY] === day) return { sent: false, reason: "already" };
  // Условная запись по прочитанной отметке: из двух кронов сводку шлёт тот, чья прошла.
  const claim = await updateSettingAtomic(ctx, DIGEST_SENT_KEY, (raw) =>
    raw === day ? null : day,
  );
  if (claim !== "written") return { sent: false, reason: "already" };
  const data = await pageAll(
    (a, b) =>
      ctx.db
        .from("consultant_message_runs")
        .select(
          "conversation_id, incoming_text, reply_text, reply_kind, status, model, token_usage",
        )
        .gte("received_at", from)
        .lt("received_at", to)
        .order("received_at", { ascending: true })
        .order("id")
        .range(a, b),
    "[consultant] запуски не прочитаны",
  );
  const { products } = await loadPricelist(ctx);
  const text = buildQualityDigest(data as DigestRun[], products, { day });
  if (!text) return { sent: false, reason: "empty" };
  return { sent: (await notify(ctx, escapeHtml(text))) > 0 };
}
