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
import {
  FOLLOW_UP_SETTING_KEY,
  FOLLOW_UP_UNTIL_MS,
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

/**
 * Фоновые задачи консультанта по прайсу (крон health, раз в 15 минут, как
 * кроны v1): свежий курс рубля (шаг 18) и одно напоминание замолчавшему
 * покупателю в директе (шаг 16). Только клиенты v2 с режимом «по прайсу» —
 * список уже отобран маршрутом крона.
 */
const MAX_FOLLOW_UPS_PER_RUN = 20;

export async function runPricelistJobs(
  tenants: Tenant[],
  now = new Date(),
  transport: ZernioTransport = liveTransport,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const t of tenants) {
    if (!pricelistMode(t)) continue;
    const ctx = tenantContext(t);
    try {
      const rate = await refreshRate(ctx);
      const followUps = await sendPricelistFollowUps(ctx, now, transport);
      const digest = await sendQualityDigest(ctx, now);
      out[t.id] = {
        rate: rate.fetched ? rate.stored?.rate : (rate.error ?? "kept"),
        followUps,
        digest,
      };
    } catch (e) {
      out[t.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

export async function sendPricelistFollowUps(
  ctx: TenantContext,
  now = new Date(),
  transport: ZernioTransport = liveTransport,
): Promise<{ checked: number; sent: number; skipped?: string; manager?: number }> {
  if ((await getSetting(ctx, FOLLOW_UP_SETTING_KEY))?.trim() !== "on")
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

  const { products } = await loadPricelist(ctx);
  let sent = 0;
  let manager = 0;
  for (const customer of candidates) {
    const memory = memoryOf(customer.state);
    const text = followUpText(memory, products, buyerLocale(ctx, customer));
    // Менеджер ответил из приложения после бота (Zernio исходящих не присылает,
    // паузы нет) — напоминание от бота поверх человека не шлём, диалог отмечаем.
    // Переписку прочитать не удалось — не знаем, кто в чате: ждём следующего крона.
    if (text) {
      const seen = await managerInChat(customer, memory, transport, now);
      if (seen === "unknown") continue;
      if (seen) {
        await claimStateSection(ctx, customer, "consultant", (cur) =>
          (cur.followup_for ?? cur.v2_followup_for) === memory.last_reply_at
            ? null
            : { ...cur, followup_for: memory.last_reply_at },
        );
        manager++;
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
  return { checked: rows.length, sent, ...(manager ? { manager } : {}) };
}

/** Хвост переписки в Zernio: есть ли ответ человека новее последнего ответа бота. */
async function managerInChat(
  customer: ReturnType<typeof customerFromRow>,
  memory: FollowUpState,
  transport: ZernioTransport,
  now: Date,
): Promise<boolean | "unknown"> {
  let tail: Awaited<ReturnType<ZernioTransport["tail"]>>;
  try {
    tail = await transport.tail(customer.zernioAccountId!, customer.zernioConversationId!);
  } catch (e) {
    console.warn(`[followup] переписка ${customer.userKey} не прочитана: ${String(e)}`);
    return "unknown";
  }
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
