import type { TenantContext } from "@/core/tenant/resolve.server";
import { displayNo, getOrder } from "@/core/orders/orders";
import {
  prodamusFor,
  prodamusOrderUrl,
  robokassaFor,
  robokassaReceipt,
  stripeFor,
} from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import { amountDueNow } from "@/core/fulfillment/fulfillment";
import { PAYABLE, hasOrderPage, orderPageUrl } from "./web-order-view";

/** Ссылки на оплату заказа с сайта: Robokassa, Stripe, Prodamus. */

/**
 * Ссылка на оплату картой через Robokassa продавца (его логин и пароли), на
 * сумму к оплате сейчас. null — заказ уже не ждёт оплаты или Robokassa у
 * продавца не подключена. Оплату подтверждает только колбэк result.
 */
export async function webCardPaymentUrl(
  ctx: TenantContext,
  orderId: number,
): Promise<string | null> {
  const order = await getOrder(ctx, orderId);
  if (!order || !(await hasOrderPage(ctx, order))) return null;
  const rk = await robokassaFor(ctx, order.currency);
  if (!rk.ready) return null;
  if (!PAYABLE.has(order.status)) {
    // Остаток по задатку: свой InvId, сумма — остаток с сервера.
    const { claimBalanceInvId, balancePayable } = await import("@/core/orders/balance");
    const left = await balancePayable(ctx, order);
    if (!left) return null;
    const what = `Остаток по заказу #${displayNo(order)}`;
    return buildPaymentUrl(rk, {
      outSum: left,
      invId: await claimBalanceInvId(ctx, order.id, left),
      description: what,
      botId: ctx.tenant.id,
      receipt: robokassaReceipt(rk, order, left, what),
    });
  }
  const due = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  if (!(due > 0)) return null;
  return buildPaymentUrl(rk, {
    outSum: due,
    invId: order.id,
    description: `Заказ #${displayNo(order)}`,
    botId: ctx.tenant.id,
    receipt: robokassaReceipt(rk, order, due, `Заказ #${displayNo(order)}`),
  });
}

/**
 * Оплата иностранной картой: сессия Stripe Checkout продавца на сумму к
 * оплате сейчас, возврат — на подписанную страницу заказа. null — заказ уже
 * не ждёт оплаты или Stripe не подключён; остаток по задатку Stripe не берёт.
 * Оплату подтверждает только вебхук /api/stripe/<bot_id>.
 */
export async function webStripePaymentUrl(
  ctx: TenantContext,
  orderId: number,
): Promise<{ ok: true; url: string } | { ok: false; reason: "closed" | "failed" }> {
  const order = await getOrder(ctx, orderId);
  if (!order || !(await hasOrderPage(ctx, order)) || !PAYABLE.has(order.status))
    return { ok: false, reason: "closed" };
  const cfg = await stripeFor(ctx);
  if (!cfg.ready) return { ok: false, reason: "closed" };
  const due = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const page = await orderPageUrl(ctx, order.id);
  if (!(due > 0) || !page) return { ok: false, reason: "closed" };
  const { createCheckoutSession } = await import("@/core/payments/stripe");
  const r = await createCheckoutSession(cfg, {
    amount: due,
    currency: order.currency,
    orderId: order.id,
    botId: ctx.tenant.id,
    description: `Заказ #${displayNo(order)}`,
    successUrl: page,
    cancelUrl: page,
    email: order.customer_email,
  });
  if (!r.ok) {
    console.error(`[stripe:${ctx.tenant.id}] сессия по заказу ${order.id}: ${r.error}`);
    return { ok: false, reason: "failed" };
  }
  return { ok: true, url: r.url };
}

/**
 * Оплата картой РФ или СБП: ссылка на форму Продамуса продавца на сумму к
 * оплате сейчас, возврат — на подписанную страницу заказа. null — заказ уже
 * не ждёт оплаты или Продамус не подключён (или заказ не в валюте его кассы).
 * Оплату подтверждает только уведомление /api/prodamus/<bot_id>.
 */
export async function webProdamusPaymentUrl(
  ctx: TenantContext,
  orderId: number,
): Promise<string | null> {
  const order = await getOrder(ctx, orderId);
  if (!order || !(await hasOrderPage(ctx, order)) || !PAYABLE.has(order.status)) return null;
  const cfg = await prodamusFor(ctx, order.currency);
  if (!cfg.ready) return null;
  const due = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const page = await orderPageUrl(ctx, order.id);
  if (!(due > 0) || !page) return null;
  const link = await prodamusOrderUrl(ctx, cfg, {
    orderId: order.id,
    no: displayNo(order),
    due,
    currency: order.currency,
    back: page,
    email: order.customer_email,
  });
  return link?.url ?? null;
}
