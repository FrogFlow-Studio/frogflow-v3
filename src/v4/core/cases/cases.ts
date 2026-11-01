import { serverFailure } from "@/lib/server-failure";
import { attempt, type V4Db, type V4Result } from "../db";

/**
 * Дела и сроки v4 (этап 2). Логика — в SQL-функциях migrations/v4/003-cases.sql:
 * дело со сроком и владельцем, шаги сроков в v4.tick(), уведомления и задачи
 * в очереди базы с ключом «один раз». Списки совпадают с check в базе
 * (cases.test.ts).
 */

export const CASE_KINDS = [
  "receipt_review",
  "handoff",
  "cant_pay",
  "underpaid",
  "payment_on_closed",
  "currency_mismatch",
  "chargeback",
  "delivery_failed",
  "notify_failed",
  "ai_limit",
  "channel_down",
  "seller_request",
] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const CASE_OWNERS = ["seller", "operator", "bot"] as const;
export type CaseOwner = (typeof CASE_OWNERS)[number];

export const NOTIFICATION_STATUSES = ["queued", "sending", "sent", "failed", "unknown"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Итог отправки. unknown — обрыв, тайм-аут, 5xx: могло дойти, повторять нельзя. */
export type SendOutcome = "sent" | "failed" | "unknown";

type Row = Record<string, unknown>;
const one = (rows: Row[], fn: string): Row => {
  const r = rows[0];
  if (!r) throw serverFailure(`v4.${fn}: пустой ответ`);
  return r;
};

export function openCase(
  db: V4Db,
  input: {
    botId: string;
    kind: CaseKind;
    /** Повод: открытое дело того же вида с тем же ключом — одно. */
    dedupeKey: string;
    by: string;
    buyerId?: string;
    orderId?: string;
    detail?: Record<string, unknown>;
  },
): Promise<V4Result<{ caseId: string; created: boolean }>> {
  return attempt(async () => {
    const r = one(
      await db.call("open_case", {
        p_bot_id: input.botId,
        p_kind: input.kind,
        p_dedupe_key: input.dedupeKey,
        p_created_by: input.by,
        p_buyer_id: input.buyerId ?? null,
        p_order_id: input.orderId ?? null,
        p_detail: input.detail ?? {},
      }),
      "open_case",
    );
    return { caseId: String(r.case_id), created: Boolean(r.created) };
  });
}

/** «Не получается оплатить» (решение 41): одно дело на покупателя, причина — для недельного топа. */
export function cantPay(
  db: V4Db,
  input: { botId: string; buyerId: string; orderId?: string; reason: string; by: string },
) {
  return openCase(db, {
    botId: input.botId,
    kind: "cant_pay",
    dedupeKey: `buyer:${input.buyerId}`,
    by: input.by,
    buyerId: input.buyerId,
    orderId: input.orderId,
    detail: { reason: input.reason },
  });
}

export function closeCase(
  db: V4Db,
  input: { botId: string; caseId: string; note: string; by: string },
): Promise<V4Result<boolean>> {
  return attempt(async () =>
    Boolean(
      one(
        await db.call("close_case", {
          p_bot_id: input.botId,
          p_case_id: input.caseId,
          p_note: input.note,
          p_created_by: input.by,
        }),
        "close_case",
      ).close_case,
    ),
  );
}

/** Покупатель просит человека: диалог «у продавца» на 4 рабочих часа (решение 7). */
export async function handToSeller(
  db: V4Db,
  input: { botId: string; buyerId: string; reason: string; by: string },
): Promise<string> {
  const r = one(
    await db.call("hand_to_seller", {
      p_bot_id: input.botId,
      p_buyer_id: input.buyerId,
      p_reason: input.reason,
      p_created_by: input.by,
    }),
    "hand_to_seller",
  );
  return String(r.hand_to_seller);
}

export async function botMayReply(db: V4Db, botId: string, buyerId: string): Promise<boolean> {
  const r = one(
    await db.call("bot_may_reply", { p_bot_id: botId, p_buyer_id: buyerId }),
    "bot_may_reply",
  );
  return Boolean(r.bot_may_reply);
}

export type TickResult = { cases: number; ordersExpired: number; notificationsUnknown: number };

/** Шаг планировщика (сервисная роль). Повторный вызов безопасен. */
export async function tick(db: V4Db, now?: Date): Promise<TickResult> {
  const args: Record<string, unknown> = {};
  if (now) args.p_now = now.toISOString();
  const r = one(await db.call("tick", args), "tick").tick as Record<string, number>;
  return {
    cases: Number(r.cases),
    ordersExpired: Number(r.orders_expired),
    notificationsUnknown: Number(r.notifications_unknown),
  };
}

export type QueuedNotification = {
  id: number;
  botId: string;
  audience: "seller" | "operator" | "buyer";
  kind: string;
  caseId: string | null;
  orderId: string | null;
  params: Record<string, unknown>;
};

/** Забрать уведомления на отправку: срочные сразу, остальные — в утреннюю сводку (решение 66). */
export async function claimNotifications(
  db: V4Db,
  urgency: "now" | "digest",
  limit = 50,
): Promise<QueuedNotification[]> {
  const rows = await db.call("claim_notifications", { p_urgency: urgency, p_limit: limit });
  return rows.map((r) => ({
    id: Number(r.id),
    botId: String(r.bot_id),
    audience: r.audience as QueuedNotification["audience"],
    kind: String(r.kind),
    caseId: (r.case_id as string | null) ?? null,
    orderId: (r.order_id as string | null) ?? null,
    params: (r.params as Record<string, unknown>) ?? {},
  }));
}

export async function finishNotification(
  db: V4Db,
  id: number,
  outcome: SendOutcome,
  error?: string,
): Promise<boolean> {
  const r = one(
    await db.call("finish_notification", { p_id: id, p_status: outcome, p_error: error ?? null }),
    "finish_notification",
  );
  return Boolean(r.finish_notification);
}
