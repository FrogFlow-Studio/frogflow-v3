/**
 * Возврат денег по заказу — своей таблицы нет (схема заморожена до фазы 7):
 * полный возврат переводит заказ в статус `refunded` (он есть в словаре
 * статусов v1), каждый возврат — событие `order.refund` таймлайна с суммой,
 * валютой, причиной и автором. Сумма возвратов по заказу считается по этим
 * событиям; ретеншн их не удаляет (retention.ts), иначе через полгода
 * частичный возврат снова попал бы в выручку.
 */
import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { eachPage } from "@/core/db/page";
import { claimOrderEvent, listOrderEvents, ORDER_EVENT_STATUS } from "./events";

/** Статусы, где деньги у продавца: из них возврат возможен. */
export const REFUNDABLE_STATUSES = [
  "paid",
  "delivering",
  "delivered",
  "completed",
  "accepted",
  "in_production",
  "ready",
] as const;

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Сколько получено по заказу: цифровой — итог; физический — внесённое
 * (`paid_amount`), выданный — не меньше итога (остаток отдали при получении).
 */
export function receivedAmount(o: {
  status: string;
  total: number | string | null;
  paid_amount?: number | string | null;
  fulfillment_kind?: string | null;
}): number {
  const total = Number(o.total) || 0;
  if (o.fulfillment_kind !== "physical") return total;
  const paid = Number(o.paid_amount) || 0;
  return o.status === "delivered" ? Math.max(paid, total) : paid;
}

export type RefundCheck =
  | { ok: true; full: boolean; remaining: number }
  | { ok: false; reason: "amount" | "over"; remaining: number };

/** Можно ли вернуть `amount`, если получено `received`, а вернули уже `refunded`. */
export function checkRefund(received: number, refunded: number, amount: number): RefundCheck {
  const remaining = cents(Math.max(0, received - refunded));
  const a = cents(amount);
  if (!(a > 0)) return { ok: false, reason: "amount", remaining };
  if (a > remaining) return { ok: false, reason: "over", remaining };
  return { ok: true, full: a === remaining, remaining: cents(remaining - a) };
}

const amountOf = (p: Record<string, unknown>) => Number(p.amount) || 0;

/** Сумма возвратов по заказу из таймлайна. */
export async function refundedAmount(ctx: TenantContext, orderId: number): Promise<number> {
  const events = await listOrderEvents(ctx, orderId);
  return cents(
    events.filter((e) => e.kind === "refund").reduce((s, e) => s + amountOf(e.payload), 0),
  );
}

/**
 * Возвраты по заказам, оформленные с `sinceIso`: заказ → сумма. Возврат не
 * бывает раньше заказа, поэтому для заказов периода достаточно событий с его
 * начала. Для аналитики: выручка заказа уменьшается на возвращённое.
 */
export async function refundsSince(
  ctx: TenantContext,
  sinceIso: string,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  await eachPage<{ payload: unknown }>(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, payload")
        .eq("status", ORDER_EVENT_STATUS)
        .eq("event_type", "order.refund")
        .gte("created_at", sinceIso)
        .order("id")
        .range(from, to),
    "возвраты для выручки",
    (rows) => {
      for (const r of rows) {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        const id = Number(p.order_id);
        if (Number.isFinite(id)) out.set(id, cents((out.get(id) ?? 0) + amountOf(p)));
      }
    },
  );
  return out;
}

/** Выручка заказа за вычетом возвращённого, не меньше нуля. */
export function netOfRefunds(revenue: number, refunded: number | undefined): number {
  return refunded ? Math.max(0, cents(revenue - refunded)) : revenue;
}

export type RefundResult = {
  full: boolean;
  amount: number;
  currency: string;
  /** Сколько ещё можно вернуть по заказу. */
  remaining: number;
  pointsReturned: number;
  pointsRevoked: number;
  restocked: number;
};

/**
 * Оформить возврат. Событие возврата пишется под номером (n0, n1, …):
 * два одновременных возврата претендуют на один номер, и второй откажет —
 * больше полученного не вернуть. Статус — условной записью по `updated_at`
 * (его двигает триггер `trg_orders_touch`); не прошла — событие снимается.
 */
export async function refundOrder(
  ctx: TenantContext,
  orderId: number,
  input: { amount: number; reason?: string | null; restock?: boolean },
  actor = "admin",
): Promise<RefundResult> {
  const { data: o, error } = await ctx.db
    .from("orders")
    .select(
      "id, status, total, paid_amount, currency, fulfillment_kind, telegram_id, points_used, points_earned, promo_code, updated_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw serverFailure(`[refund] заказ #${orderId} не прочитан: ${error.message}`);
  if (!o) throw new UserError("err.orders.notFound", "Заказ не найден");
  if (!(REFUNDABLE_STATUSES as readonly string[]).includes(o.status))
    throw new UserError(
      "err.refund.notRefundable",
      "По заказу в этом статусе денег не получено — возвращать нечего",
    );
  // Возвраты заказа — по событиям; номер следующего — ключ события: два
  // одновременных возврата претендуют на один ключ, запишется только первый.
  const refunds = (await listOrderEvents(ctx, orderId)).filter((e) => e.kind === "refund");
  const refunded = cents(refunds.reduce((sum, e) => sum + amountOf(e.payload), 0));
  const check = checkRefund(receivedAmount(o), refunded, input.amount);
  if (!check.ok)
    throw check.reason === "amount"
      ? new UserError("err.orders.amountPositive", "Сумма должна быть больше нуля")
      : new UserError("err.refund.overRefundable", "Можно вернуть не больше {remaining}", {
          remaining: `${check.remaining} ${o.currency}`,
        });
  const amount = cents(input.amount);
  const reason = input.reason?.trim().slice(0, 500) || undefined;
  const key = `n${refunds.length}`;
  const base = { amount, currency: o.currency, full: check.full, ...(reason ? { reason } : {}) };
  const changed = () =>
    new UserError("err.refund.changed", "Заказ только что изменился — обновите страницу");
  if (!(await claimOrderEvent(ctx, orderId, "refund", key, base, actor))) throw changed();
  const eventId = `order:${orderId}:refund:${key}`;
  const { data: won, error: wonError } = await ctx.db
    .from("orders")
    .update({ status: check.full ? "refunded" : o.status })
    .eq("id", orderId)
    .eq("updated_at", o.updated_at)
    .select("id")
    .maybeSingle();
  if (wonError || !won) {
    // Метку возврата снимаем и при сбое записи: иначе сумма уже посчитана в журнале,
    // а статус заказа не менялся.
    const { error: releaseError } = await ctx.db
      .from("zernio_logs")
      .delete()
      .eq("event_id", eventId);
    if (releaseError)
      console.error(`[refund] метка возврата ${eventId} не снята: ${releaseError.message}`);
    if (wonError)
      throw serverFailure(`[refund] статус заказа #${orderId} не записан: ${wonError.message}`);
    throw changed();
  }

  let pointsReturned = 0;
  let pointsRevoked = 0;
  let codes = { promo: false, gift: false };
  if (check.full) {
    const { restorePoints, returnOrderCodes, revokePoints } =
      await import("@/core/discounts/discounts");
    const tg = Number(o.telegram_id);
    pointsReturned = Math.max(0, Math.floor(Number(o.points_used) || 0));
    if (pointsReturned > 0) await restorePoints(ctx, tg, pointsReturned);
    const earned = Math.max(0, Math.floor(Number(o.points_earned) || 0));
    if (earned > 0 && (await revokePoints(ctx, tg, earned))) pointsRevoked = earned;
    codes = await returnOrderCodes(ctx, orderId, o.promo_code).catch(() => codes);
  }
  // Склад возвращается один раз на заказ: restoreOrderStock кладёт все позиции целиком.
  let restocked = 0;
  if (input.restock && !refunds.some((e) => Number(e.payload.restocked) > 0)) {
    const { restoreOrderStock } = await import("@/core/fulfillment/fulfillment");
    restocked = await restoreOrderStock(ctx, orderId);
  }
  const payload = {
    order_id: orderId,
    actor,
    ...base,
    ...(pointsReturned ? { pointsReturned } : {}),
    ...(pointsRevoked ? { pointsRevoked } : {}),
    ...(codes.promo ? { promoReturned: true } : {}),
    ...(codes.gift ? { giftReturned: true } : {}),
    ...(restocked ? { restocked } : {}),
  };
  if (pointsReturned || pointsRevoked || codes.promo || codes.gift || restocked)
    await ctx.db
      .from("zernio_logs")
      .update({ payload })
      .eq("event_id", eventId)
      .then(({ error: payloadError }) => {
        if (payloadError)
          console.error(`[refund] детали возврата ${eventId} не записаны: ${payloadError.message}`);
      });
  // Событие записано ключом, мимо recordOrderEvent: во внешнюю CRM — отдельно.
  if (ctx.tenant.modules.crm_integration) {
    const { queueCrmEvent } = await import("@/core/crm/webhook");
    await queueCrmEvent(ctx, "refund", orderId, payload).catch((e) =>
      console.warn(`[crm] событие refund для #${orderId}: ${String(e)}`),
    );
  }
  return {
    full: check.full,
    amount,
    currency: o.currency,
    remaining: check.remaining,
    pointsReturned,
    pointsRevoked,
    restocked,
  };
}
