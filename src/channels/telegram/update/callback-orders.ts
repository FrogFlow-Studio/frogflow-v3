// Кнопки после заказа: отзыв о товаре и товар-подписка.
import {
  hasDeliveredPurchase,
  reviewableProductsForOrder,
  saveRating,
} from "@/core/reviews/reviews";
import { isValidRating } from "@/core/reviews/pure";
import { getProduct } from "@/core/catalog/catalog";
import { type Customer, setState } from "@/core/customers/customers";
import { addToCart } from "@/core/cart/cart";
import { getOrder } from "@/core/orders/orders";
import { type Bot, send } from "./bot";
import { startCheckout } from "./checkout";
import { askRating } from "./orders";

/** Отзыв: выбор товара, оценка звёздами, пропуск комментария. */
export async function reviewButton(
  b: Bot,
  customer: Customer,
  data: string,
  fromId: number,
): Promise<void> {
  const { ctx } = b;
  if (data.startsWith("rate:") && ctx.tenant.modules.review_request) {
    const products = await reviewableProductsForOrder(ctx, Number(data.slice(5)), fromId);
    if (products.length === 0) return send(b, b.m.noReviewableProducts);
    if (products.length === 1) return askRating(b, products[0]!.productId, products[0]!.name);
    return send(b, b.m.chooseProductToRate, {
      reply_markup: {
        inline_keyboard: products.map((p) => [
          { text: p.name, callback_data: `rateproduct:${p.productId}` },
        ]),
      },
    });
  }
  if (data.startsWith("rateproduct:") && ctx.tenant.modules.review_request) {
    const productId = data.slice(12);
    if (!(await hasDeliveredPurchase(ctx, fromId, productId))) return send(b, b.m.reviewNotAllowed);
    const p = await getProduct(ctx, productId);
    return askRating(b, productId, p?.name ?? "");
  }
  if (data.startsWith("stars:") && ctx.tenant.modules.review_request) {
    const [, productId = "", raw = ""] = data.split(":");
    const rating = Number(raw);
    if (!isValidRating(rating)) return;
    if (!(await hasDeliveredPurchase(ctx, fromId, productId))) return send(b, b.m.reviewNotAllowed);
    await saveRating(ctx, fromId, productId, rating);
    b.customer = await setState(ctx, b.customer, {
      ...b.customer.state,
      mode: "awaiting_review_comment",
      review_product_id: productId,
    });
    return send(b, b.m.reviewSaved, {
      reply_markup: {
        inline_keyboard: [[{ text: b.m.reviewSkipBtn, callback_data: "reviewskip" }]],
      },
    });
  }
  if (data === "reviewskip") {
    const { review_product_id: _rp, ...rest } = b.customer.state;
    b.customer = await setState(ctx, b.customer, { ...rest, mode: "idle" });
    return send(b, b.m.useMenu);
  }
}

/** Товар-подписка: продлить или отключить напоминания. */
export async function subscriptionButton(b: Bot, customer: Customer, data: string): Promise<void> {
  const { ctx } = b;
  if (data.startsWith("subren:")) {
    // Продление товара-подписки (core/catalog/subscription): товар из прошлого заказа — в корзину.
    const [, orderRaw, productId = ""] = data.split(":");
    const order = await getOrder(ctx, Number(orderRaw));
    if (!order || order.telegram_id !== customer.telegramId) return;
    const item = order.order_items.find((i) => i.product_id === productId);
    if (!item) return;
    const r = await addToCart(ctx, customer, productId, item.product_variant_id ?? null);
    if (r !== "ok") return void (await send(b, b.m.renewUnavailable));
    return startCheckout(b);
  }
  if (data.startsWith("suboff:")) {
    const { withSubscriptionOff } = await import("@/core/catalog/subscription");
    b.customer = await setState(
      ctx,
      customer,
      withSubscriptionOff(customer.state, data.slice(7), true),
    );
    return void (await send(b, b.m.subOffDone));
  }
}
