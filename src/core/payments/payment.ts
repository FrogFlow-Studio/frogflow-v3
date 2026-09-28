import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings } from "@/core/settings/settings";
import { receiptFor, type Receipt } from "./receipt";
import {
  ROBOKASSA_KEYS,
  robokassaAccepts,
  robokassaConfig,
  type RobokassaConfig,
} from "./robokassa";

/**
 * Robokassa продавца. С валютой заказа — только в валюте его кассы:
 * Казахстан списывает OutSum в тенге, Россия — в рублях, и заказ в долларах
 * на 20 оплатился бы 20 ₸ (или 20 ₽).
 */
export async function robokassaFor(ctx: TenantContext, currency?: string | null) {
  const cfg = robokassaConfig(await getSettings(ctx, ROBOKASSA_KEYS), ctx.tenant.modules.robokassa);
  if (cfg.ready && currency != null && !robokassaAccepts(currency, cfg.region))
    return { ready: false as const };
  return cfg;
}

/**
 * Чек 54-ФЗ к ссылке Robokassa (только Россия с включённым чеком): позиции
 * заказа на сумму платежа. undefined — касса без чека.
 */
export function robokassaReceipt(
  rk: RobokassaConfig,
  order: Parameters<typeof receiptFor>[0],
  outSum: number,
  description: string,
): Receipt | undefined {
  return rk.region === "ru" && rk.receipt
    ? receiptFor(order, outSum, rk.receipt, description)
    : undefined;
}

/** Оплата криптой (модуль crypto, core/payments/nowpayments). */
export async function nowpaymentsFor(ctx: TenantContext) {
  const { NOWPAYMENTS_KEYS, nowpaymentsConfig } = await import("./nowpayments");
  return nowpaymentsConfig(await getSettings(ctx, NOWPAYMENTS_KEYS), ctx.tenant.modules.crypto);
}

/** Оплата иностранной картой (модуль stripe, core/payments/stripe). */
export async function stripeFor(ctx: TenantContext) {
  const { STRIPE_KEYS, stripeConfig } = await import("./stripe");
  return stripeConfig(await getSettings(ctx, STRIPE_KEYS), ctx.tenant.modules.stripe);
}

/**
 * Онлайн-оплата подтверждена шлюзом: отметить, что деньги получены.
 * Цифровой заказ дальше выдаёт канал, физический принимается в работу.
 * Идемпотентно: повторный колбэк на закрытый заказ ничего не меняет.
 */
export async function markPaidOnline(
  ctx: TenantContext,
  orderId: number,
  amount: number,
  provider: string,
  /** Номер платежа у шлюза (InvId Robokassa, charge id Telegram) — в выгрузку «Оплаты». */
  ref?: string,
): Promise<{ ok: boolean; kind: "digital" | "physical" | null; alreadyDone: boolean }> {
  const { data: order } = await ctx.db
    .from("orders")
    .select("status, fulfillment_kind, admin_note, paid_amount, total, currency")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, kind: null, alreadyDone: false };
  const kind = order.fulfillment_kind === "physical" ? "physical" : "digital";
  if (!["awaiting_payment", "awaiting_confirmation"].includes(order.status))
    return { ok: true, kind, alreadyDone: true };
  const note =
    `${order.admin_note ? `${order.admin_note}; ` : ""}Оплачено через ${provider}: ${amount}`.slice(
      0,
      500,
    );
  const paid = Math.min(Number(order.total), Number(order.paid_amount ?? 0) + amount);
  const patch =
    kind === "physical"
      ? { status: "accepted", payment_proof_path: provider, admin_note: note, paid_amount: paid }
      : { status: "paid", payment_proof_path: provider, admin_note: note, paid_amount: paid };
  const { data } = await ctx.db
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .in("status", ["awaiting_payment", "awaiting_confirmation"])
    .select("id")
    .maybeSingle();
  // Платёж — в журнал заказа: из него собирается выгрузка «Оплаты».
  if (data) {
    const { recordOrderEvent } = await import("@/core/orders/events");
    await recordOrderEvent(
      ctx,
      orderId,
      "payment",
      { amount, currency: order.currency, source: "online", provider, invId: ref },
      "system",
    ).catch((e) =>
      console.error(`[payments] платёж #${orderId} через ${provider} не записан в журнал`, e),
    );
  }
  return { ok: Boolean(data), kind, alreadyDone: !data };
}
