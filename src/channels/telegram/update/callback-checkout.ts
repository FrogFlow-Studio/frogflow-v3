// Кнопки корзины и оформления: «в корзину», промокод, подарок, баллы, шаги выдачи, согласование.
import { type Customer, setState } from "@/core/customers/customers";
import { addToCart } from "@/core/cart/cart";
import { freeSlotsOnDate } from "@/core/fulfillment/capacity";
import { serverFailure } from "@/lib/server-failure";
import { type Bot, send } from "./bot";
import { showCart } from "./cart";
import {
  afterDate,
  answerApproval,
  askFulfillmentDate,
  finishAfterNote,
  pickZone,
} from "./checkout";

/** «В корзину»: ответ на нажатие — своим текстом (answerCallbackQuery). */
export async function addToCartButton(
  b: Bot,
  customer: Customer,
  data: string,
  callbackQueryId: string,
): Promise<void> {
  const { ctx, api } = b;
  const [, productId = "", variantId, from] = data.split(":");
  const r = await addToCart(ctx, customer, productId, variantId || null);
  if (r === "ok" && from === "u") {
    const { recordEngage } = await import("@/core/automsg/engage");
    await recordEngage(ctx, "upsell_add", customer.telegramId);
  }
  const text = {
    ok: b.m.added,
    unavailable: b.m.unavailable,
    mixed_cart: b.m.mixedCart,
    digital_limit: b.m.digitalLimit,
    out_of_stock: b.m.outOfStock,
    error: b.m.orderCreateFailed,
  }[r];
  await api.call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text.slice(0, 200),
    show_alert: r !== "ok",
  });
  if (r === "ok")
    await send(b, `${b.m.added} · ${b.m.cart}`, {
      reply_markup: { inline_keyboard: [[{ text: b.m.cart, callback_data: "cart:show" }]] },
    });
}

/** Промокод, подарок, сертификат и баллы в корзине. */
export async function cartOptionButton(b: Bot, customer: Customer, data: string): Promise<void> {
  const { ctx } = b;
  if (data === "promo:enter") {
    b.customer = await setState(ctx, customer, { ...customer.state, mode: "awaiting_promo_code" });
    return void (await send(b, b.m.promoCodePrompt));
  }
  if (data === "promo:clear") {
    const { promo_code: _pc, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, rest);
    await send(b, b.m.promoCodeRemoved);
    return showCart(b);
  }
  if (data === "gift:enter" && ctx.tenant.modules.bundles) {
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_gift_recipient",
    });
    return void (await send(b, b.m.giftRecipientPrompt));
  }
  if (data === "gift:skip") {
    if (customer.state.mode !== "awaiting_gift_message") return;
    b.customer = await setState(ctx, customer, { ...customer.state, mode: "idle" });
    return showCart(b);
  }
  if ((data === "gift:wrap" || data === "gift:unwrap") && ctx.tenant.modules.bundles) {
    const { gift_wrap: _gw, ...rest } = customer.state;
    b.customer = await setState(
      ctx,
      customer,
      data === "gift:wrap" ? { ...rest, gift_wrap: true } : rest,
    );
    return showCart(b);
  }
  if (data === "gift:clear") {
    const {
      gift_on: _g,
      gift_recipient: _gr,
      gift_message: _gm,
      gift_wrap: _gw,
      ...rest
    } = customer.state;
    b.customer = await setState(ctx, customer, rest);
    return showCart(b);
  }
  if (data === "giftcert:enter") {
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_gift_certificate_code",
    });
    return void (await send(b, b.m.giftCertificateCodePrompt));
  }
  if (data === "giftcert:clear") {
    const { gift_certificate_code: _gc, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, rest);
    await send(b, b.m.giftCertificateRemoved);
    return showCart(b);
  }
  if (data === "points:use" || data === "points:clear") {
    const { use_points: _u, ...rest } = customer.state;
    b.customer = await setState(
      ctx,
      customer,
      data === "points:use" ? { ...rest, use_points: true } : rest,
    );
    return showCart(b);
  }
}

/** Шаги оформления: способ и слот выдачи, зона доставки, комментарий, согласование макета. */
export async function checkoutStepButton(b: Bot, customer: Customer, data: string): Promise<void> {
  const { ctx } = b;
  if (data.startsWith("fulfilltype:")) {
    if (customer.state.mode !== "awaiting_fulfillment_type") return;
    const type = data.slice(12);
    if (type !== "pickup" && type !== "delivery") return;
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      checkout_fulfillment_type: type,
    });
    return askFulfillmentDate(b);
  }
  if (data.startsWith("slot:")) {
    if (customer.state.mode !== "awaiting_fulfillment_slot") return;
    const { fulfillmentSlots, withSlot } = await import("@/core/fulfillment/slots");
    const slot = (await fulfillmentSlots(ctx))[Number(data.slice(5))];
    const date = customer.state.checkout_fulfillment_at;
    if (!slot || !date) return askFulfillmentDate(b);
    if (!(await freeSlotsOnDate(ctx, date)).includes(slot)) {
      await send(b, b.m.fulfillmentSlotFull);
      return afterDate(b);
    }
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      checkout_fulfillment_at: withSlot(date, slot),
    });
    return afterDate(b);
  }
  if (data.startsWith("appr:")) {
    const [, what, id] = data.split(":");
    const orderId = Number(id);
    const { data: o, error: oErr } = await ctx.db
      .from("orders")
      .select("telegram_id")
      .eq("id", orderId)
      .maybeSingle();
    if (oErr) throw serverFailure(`[telegram] заказ не прочитан: ${oErr.message}`);
    // Кнопка чужого заказа (пересланное сообщение) ничего не делает.
    if (!o || Number(o.telegram_id) !== customer.telegramId) return;
    if (what === "ok") return answerApproval(b, orderId, { ok: true });
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_approval_changes",
      approval_order_id: orderId,
    });
    return void (await send(b, b.m.approvalAskChanges));
  }
  if (data.startsWith("zone:")) {
    if (customer.state.mode !== "awaiting_delivery_zone") return;
    return pickZone(b, data.slice(5));
  }
  if (data === "fulfillnote:skip") {
    if (customer.state.mode !== "awaiting_fulfillment_note") return;
    return finishAfterNote(b, null);
  }
}
