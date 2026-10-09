// Кнопки оплаты заказа (pay:<способ>:<заказ>): ссылка на кассу, счёт Stars или реквизиты.
import { formatMoney } from "@/core/money/money";
import { type Customer, setState } from "@/core/customers/customers";
import { displayNo, getOrder, listActivePaymentMethods } from "@/core/orders/orders";
import { robokassaFor, robokassaReceipt } from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import { type Bot, send } from "./bot";
import { sendManualInstructions } from "./checkout";
import { starsDue } from "./payments";
import { prodamusCopy, prodamusSum } from "../copy";

/** Кнопка «Оплатить …» под заказом: ссылка на кассу, счёт Stars или реквизиты. */
export async function payButton(b: Bot, customer: Customer, data: string): Promise<void> {
  const { ctx, api, chatId } = b;
  const [, kind, idRaw] = data.split(":");
  const order = await getOrder(ctx, Number(idRaw));
  if (!order || order.telegram_id !== customer.telegramId || order.status !== "awaiting_payment")
    return;
  const no = displayNo(order);
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const due = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  if (kind === "rk") {
    const rk = await robokassaFor(ctx, order.currency);
    if (!rk.ready) return;
    const url = buildPaymentUrl(rk, {
      outSum: due,
      invId: order.id,
      description: `Заказ #${no}`,
      botId: ctx.tenant.id,
      receipt: robokassaReceipt(rk, order, due, `Заказ #${no}`),
    });
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_payment",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await send(
      b,
      `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(due, order.currency))}\n\n${b.m.robokassaHint}`,
      { reply_markup: { inline_keyboard: [[{ text: b.m.payViaRobokassaBtn, url }]] } },
    );
    return;
  }
  if (kind === "crypto") {
    const { nowpaymentsFor } = await import("@/core/payments/payment");
    const cfg = await nowpaymentsFor(ctx);
    if (!cfg.ready) return;
    const { createInvoice } = await import("@/core/payments/nowpayments");
    const username = ctx.tenant.settings.telegram?.username;
    const back = username ? `https://t.me/${username}` : ctx.appUrl;
    const inv = await createInvoice(cfg, {
      amount: due,
      currency: order.currency,
      orderId: order.id,
      description: `Заказ #${no}`,
      ipnUrl: `${ctx.appUrl}/api/nowpayments/${ctx.tenant.id}`,
      successUrl: back,
      cancelUrl: back,
    });
    if (!inv.ok) {
      console.error(`[nowpayments:${ctx.tenant.id}] счёт по заказу ${order.id}: ${inv.error}`);
      return void (await send(b, b.m.cryptoUnavailable));
    }
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_payment",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await send(
      b,
      `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(due, order.currency))}\n\n${b.m.cryptoHint}`,
      { reply_markup: { inline_keyboard: [[{ text: b.m.payViaCryptoBtn, url: inv.url }]] } },
    );
    return;
  }
  if (kind === "stripe") {
    const { stripeFor } = await import("@/core/payments/payment");
    const cfg = await stripeFor(ctx);
    if (!cfg.ready) return;
    const { createCheckoutSession } = await import("@/core/payments/stripe");
    const username = ctx.tenant.settings.telegram?.username;
    const back = username ? `https://t.me/${username}` : ctx.appUrl;
    const session = await createCheckoutSession(cfg, {
      amount: due,
      currency: order.currency,
      orderId: order.id,
      botId: ctx.tenant.id,
      description: `Заказ #${no}`,
      successUrl: back,
      cancelUrl: back,
      email: order.customer_email,
    });
    if (!session.ok) {
      console.error(`[stripe:${ctx.tenant.id}] сессия по заказу ${order.id}: ${session.error}`);
      return void (await send(b, b.m.stripeUnavailable));
    }
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_payment",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await send(
      b,
      `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(due, order.currency))}\n\n${b.m.stripeHint}`,
      { reply_markup: { inline_keyboard: [[{ text: b.m.payViaStripeBtn, url: session.url }]] } },
    );
    return;
  }
  if (kind === "pdm") {
    const { prodamusFor, prodamusOrderUrl } = await import("@/core/payments/payment");
    const cfg = await prodamusFor(ctx, order.currency);
    if (!cfg.ready) return;
    const username = ctx.tenant.settings.telegram?.username;
    const link = await prodamusOrderUrl(ctx, cfg, {
      orderId: order.id,
      no,
      due,
      currency: order.currency,
      back: username ? `https://t.me/${username}` : ctx.appUrl,
      email: order.customer_email,
    });
    if (!link) return;
    const sum = prodamusSum(b.m, link, due, order.currency);
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_payment",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    const pc = prodamusCopy(b.m, link.currency, order.currency);
    await send(b, `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(sum)}\n\n${pc.hint}`, {
      reply_markup: { inline_keyboard: [[{ text: pc.btn, url: link.url }]] },
    });
    return;
  }
  if (kind === "stars") {
    const stars = await starsDue(ctx, order);
    if (!stars) return;
    const { starsPayload } = await import("@/core/payments/stars");
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_payment",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await api.call("sendInvoice", {
      chat_id: chatId,
      title: b.m.starsInvoiceTitle(no),
      description: `${b.m.starsInvoiceDesc} · ${formatMoney(due, order.currency)}`,
      payload: starsPayload(order.id),
      currency: "XTR",
      prices: [{ label: b.m.starsInvoiceTitle(no), amount: stars }],
    });
    return;
  }
  if (kind === "manual") {
    const method =
      (await listActivePaymentMethods(ctx)).find((x) => x.country_code === order.country_code) ??
      null;
    const physical = order.fulfillment_kind === "physical";
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_proof",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    const depositLine =
      physical && due < Number(order.total)
        ? `${b.m.depositLine(formatMoney(due, order.currency), formatMoney(order.total, order.currency))}\n\n`
        : "";
    return sendManualInstructions(b, {
      no,
      due,
      total: Number(order.total),
      currency: order.currency,
      instructions: method?.instructions ?? null,
      qr: method?.qr_code_path ?? null,
      physical,
      depositLine,
    });
  }
}
