import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingsStrict } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
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
  const cfg = robokassaConfig(
    await getSettingsStrict(ctx, ROBOKASSA_KEYS),
    ctx.tenant.modules.robokassa,
  );
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
  return nowpaymentsConfig(
    await getSettingsStrict(ctx, NOWPAYMENTS_KEYS),
    ctx.tenant.modules.crypto,
  );
}

/** Оплата иностранной картой (модуль stripe, core/payments/stripe). */
export async function stripeFor(ctx: TenantContext) {
  const { STRIPE_KEYS, stripeConfig } = await import("./stripe");
  return stripeConfig(await getSettingsStrict(ctx, STRIPE_KEYS), ctx.tenant.modules.stripe);
}

/** Заказ, по которому оплату уже не ждут: отменён, отклонён или возвращён. */
const CLOSED_ORDER_STATUSES = ["cancelled", "rejected", "refunded"];

export type UnappliedPaymentKind = "payment_on_closed" | "payment_mismatch";

export type UnappliedPayment = {
  amount: number;
  currency: string;
  provider: string;
  /** Номер платежа у шлюза. */
  ref: string;
  /** Статус заказа или причина расхождения — для продавца. */
  status?: string;
};

/**
 * Деньги от шлюза, которые заказ не принял: оплата по закрытому заказу или
 * сумма/валюта не совпали. В заказе ничего не меняем, но платёж оставляет
 * событие в журнале (сумма, валюта, шлюз, номер платежа) — продавец и бухгалтер
 * его видят. Повтор того же колбэка — `false`, второй записи и второго
 * уведомления нет. Сбой базы — serverFailure: шлюз повторит колбэк.
 */
export async function recordUnappliedPayment(
  ctx: TenantContext,
  orderId: number,
  kind: UnappliedPaymentKind,
  p: UnappliedPayment,
): Promise<boolean> {
  const { claimOrderEvent } = await import("@/core/orders/events");
  const payload = {
    amount: p.amount,
    currency: p.currency,
    provider: p.provider,
    invId: p.ref,
    status: p.status,
  };
  const key = `${p.provider.toLowerCase()}:${p.ref || "noref"}:${p.amount.toFixed(2)}`;
  if (kind === "payment_on_closed" && p.ref) {
    // Повтор колбэка уже принятой оплаты, заказ потом вернули: платёж записан, тревоги нет.
    const { data: accepted, error: acceptedError } = await ctx.db
      .from("zernio_logs")
      .select("id")
      .eq("event_type", "order.payment")
      .eq("payload->>order_id", String(orderId))
      .eq("payload->>invId", p.ref)
      .limit(1);
    if (acceptedError)
      throw serverFailure(
        `recordUnappliedPayment: журнал заказа #${orderId}: ${acceptedError.message}`,
      );
    if ((accepted ?? []).length > 0) return false;
  }
  if (await claimOrderEvent(ctx, orderId, kind, key, payload, "system")) return true;
  // Метки нет — повтор или сбой записи; сбой должен вернуться шлюзу как 5xx.
  const { data: seen, error: seenError } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .eq("event_id", `order:${orderId}:${kind}:${key}`)
    .maybeSingle();
  if (seen && !seenError) return false;
  throw serverFailure(`recordUnappliedPayment: не записан платёж по заказу #${orderId}`);
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
): Promise<{
  ok: boolean;
  kind: "digital" | "physical" | null;
  alreadyDone: boolean;
  /** Заказ закрыт (отменён, отклонён, возвращён): деньги пришли, решает продавец. */
  closed?: boolean;
  /** Статус заказа на момент колбэка. */
  status?: string;
}> {
  const { data: order, error: readError } = await ctx.db
    .from("orders")
    .select("status, fulfillment_kind, admin_note, paid_amount, total, currency")
    .eq("id", orderId)
    .maybeSingle();
  // Сбой чтения — не «заказ не найден»: шлюз получит 5xx и повторит колбэк.
  if (readError)
    throw serverFailure(`markPaidOnline: не прочитан заказ #${orderId}: ${readError.message}`);
  if (!order) return { ok: false, kind: null, alreadyDone: false };
  const kind = order.fulfillment_kind === "physical" ? "physical" : "digital";
  if (!["awaiting_payment", "awaiting_confirmation"].includes(order.status))
    return {
      ok: true,
      kind,
      alreadyDone: true,
      closed: CLOSED_ORDER_STATUSES.includes(order.status),
      status: order.status,
    };
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
  const { data, error: updateError } = await ctx.db
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .in("status", ["awaiting_payment", "awaiting_confirmation"])
    .select("id")
    .maybeSingle();
  if (updateError)
    throw serverFailure(
      `markPaidOnline: не записана оплата заказа #${orderId}: ${updateError.message}`,
    );
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
