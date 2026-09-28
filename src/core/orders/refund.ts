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
import { eachPage } from "@/core/db/page";
import { listOrderEvents, ORDER_EVENT_STATUS, recordOrderEvent } from "./events";

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
 * Оформить возврат. Условная запись по `updated_at` (его двигает триггер
 * `trg_orders_touch`): два одновременных нажатия не вернут больше
 * полученного — второе увидит изменившийся заказ и откажет.
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
  if (error) throw new Error(error.message);
  if (!o) throw new UserError("err.orders.notFound", "Заказ не найден");
  if (!(REFUNDABLE_STATUSES as readonly string[]).includes(o.status))
    throw new UserError(
      "err.refund.notRefundable",
      "По заказу в этом статусе денег не получено — возвращать нечего",
    );
  const check = checkRefund(receivedAmount(o), await refundedAmount(ctx, orderId), input.amount);
  if (!check.ok)
    throw check.reason === "amount"
      ? new UserError("err.orders.amountPositive", "Сумма должна быть больше нуля")
      : new UserError("err.refund.overRefundable", "Можно вернуть не больше {remaining}", {
          remaining: `${check.remaining} ${o.currency}`,
        });
  const { data: won } = await ctx.db
    .from("orders")
    .update({ status: check.full ? "refunded" : o.status })
    .eq("id", orderId)
    .eq("updated_at", o.updated_at)
    .select("id")
    .maybeSingle();
  if (!won)
    throw new UserError("err.refund.changed", "Заказ только что изменился — обновите страницу");

  const amount = cents(input.amount);
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
  let restocked = 0;
  if (input.restock) {
    const { restoreOrderStock } = await import("@/core/fulfillment/fulfillment");
    restocked = await restoreOrderStock(ctx, orderId);
  }
  const reason = input.reason?.trim().slice(0, 500) || undefined;
  await recordOrderEvent(
    ctx,
    orderId,
    "refund",
    {
      amount,
      currency: o.currency,
      full: check.full,
      ...(reason ? { reason } : {}),
      ...(pointsReturned ? { pointsReturned } : {}),
      ...(pointsRevoked ? { pointsRevoked } : {}),
      ...(codes.promo ? { promoReturned: true } : {}),
      ...(codes.gift ? { giftReturned: true } : {}),
      ...(restocked ? { restocked } : {}),
    },
    actor,
  );
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
