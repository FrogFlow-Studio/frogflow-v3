import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import {
  claimOrderPlacement,
  listActivePaymentMethods,
  paymentMethodFor,
  releaseOrderPlacement,
  type OrderWithItems,
} from "@/core/orders/orders";
import { recordOrderEvent } from "@/core/orders/events";
import { formatMoney } from "@/core/money/money";
import {
  GIFT_ITEM_NAME,
  giftSaleOpen,
  giftSaleSettings,
  markGiftSale,
} from "@/core/discounts/gift-sale";

/**
 * Покупка подарочного сертификата на витрине сайта: отдельный цифровой заказ
 * с одной позицией без товара, корзина покупателя не трогается. Скидки
 * (промокод, баллы, другой сертификат) к такой покупке не применяются.
 * Платит покупатель так же, как за обычный заказ с сайта; код появляется
 * только при выдаче (core/orders deliverOrder → core/discounts/gift-sale).
 */
export type GiftPlaceResult =
  | { ok: true; order: OrderWithItems; amountDue: number }
  | {
      ok: false;
      reason: "closed" | "amount" | "country_unavailable" | "busy" | "order_failed";
    };

/** Страны, где сертификат можно оплатить: способ оплаты в валюте сертификата. */
export async function giftSaleCountries(
  ctx: TenantContext,
): Promise<Array<{ code: string; name: string }>> {
  const { currency } = giftSaleSettings(ctx);
  const methods = await listActivePaymentMethods(ctx);
  return [
    ...new Map(
      methods
        .filter((m) => m.country_code && m.currency === currency)
        .map((m) => [m.country_code, m.country_name || m.country_code]),
    ).entries(),
  ].map(([code, name]) => ({ code, name }));
}

export async function placeGiftOrder(
  ctx: TenantContext,
  customer: Customer,
  amount: number,
  countryCode: string,
  contact: { name: string; phone: string | null },
): Promise<GiftPlaceResult> {
  if (!giftSaleOpen(ctx)) return { ok: false, reason: "closed" };
  const { amounts, currency } = giftSaleSettings(ctx);
  if (!amounts.includes(amount)) return { ok: false, reason: "amount" };
  const method = await paymentMethodFor(ctx, countryCode);
  if (!method || method.currency !== currency) return { ok: false, reason: "country_unavailable" };
  if (!(await claimOrderPlacement(ctx, customer))) return { ok: false, reason: "busy" };
  try {
    const { data: order, error } = await ctx.db
      .from("orders")
      .insert({
        bot_id: ctx.tenant.id,
        telegram_id: customer.telegramId,
        user_key: customer.userKey,
        platform: customer.platform,
        username: customer.username,
        display_name: contact.name.slice(0, 64),
        contact: contact.phone,
        customer_email: customer.email?.trim() || null,
        country_code: method.country_code,
        country_name: method.country_name,
        total: amount,
        currency,
        status: "awaiting_payment",
        fulfillment_kind: "digital",
      })
      .select("*")
      .single();
    if (error || !order) return { ok: false, reason: "order_failed" };
    const { error: itemError } = await ctx.db.from("order_items").insert({
      bot_id: ctx.tenant.id,
      order_id: order.id,
      product_id: null,
      name_snapshot: `${GIFT_ITEM_NAME} ${formatMoney(amount, currency)}`,
      price_snapshot: amount,
      quantity: 1,
    });
    if (itemError || !(await markGiftSale(ctx, order.id, { amount, currency }))) {
      await ctx.db.from("order_items").delete().eq("order_id", order.id);
      await ctx.db.from("orders").delete().eq("id", order.id);
      return { ok: false, reason: "order_failed" };
    }
    const { data: full } = await ctx.db
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", order.id)
      .single();
    await recordOrderEvent(ctx, order.id, "placed", {
      platform: order.platform,
      total: amount,
      currency,
      gift: true,
    });
    return {
      ok: true,
      order: (full ?? { ...order, order_items: [] }) as OrderWithItems,
      amountDue: amount,
    };
  } finally {
    await releaseOrderPlacement(ctx, customer).catch(() => {});
  }
}
