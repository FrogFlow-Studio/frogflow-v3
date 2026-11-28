import type { TenantContext } from "@/core/tenant/resolve.server";
import { type Customer } from "@/core/customers/customers";
import { clearCart, listCart } from "@/core/cart/cart";
import { importItems, type HandoffItem } from "./handoff";
import {
  resolveWebFulfillment,
  type WebFulfillmentCheck,
  type WebFulfillmentRequest,
} from "./web-fulfillment";
import {
  deliverOrder,
  placeOrder,
  type DeliverResult,
  type MaterialSender,
  type PlaceOrderResult,
} from "@/core/orders/orders";
import { serverFailure } from "@/lib/server-failure";
import { payLane } from "@/v4/core/served-by";

/** Оформление и выдача заказа с сайта. */

/**
 * Потолок штук одной позиции в заказе с сайта: оформляет его кто угодно,
 * и без потолка один запрос списал бы со склада всё. Больше — через бота
 * или продавца.
 */
export const WEB_MAX_QTY = 5;

export type WebPlaceResult =
  | PlaceOrderResult
  | { ok: true; via: "v4"; orderId: string; no: number }
  | { ok: false; reason: "nothing_imported" | "too_many" }
  | Extract<WebFulfillmentCheck, { ok: false }>;

export function isV4WebOrder(
  r: WebPlaceResult,
): r is { ok: true; via: "v4"; orderId: string; no: number } {
  return r.ok === true && "via" in r && r.via === "v4";
}

/**
 * Корзина с сайта → заказ. Корзина покупателя в базе сначала очищается:
 * на сайте он видит только то, что сейчас в браузере. Для физических
 * товаров способ получения, дата и адрес проверяются по корзине в базе
 * (срок изготовления её товаров) до placeOrder.
 */
export async function placeWebOrder(
  ctx: TenantContext,
  customer: Customer,
  items: HandoffItem[],
  countryCode: string,
  opts: {
    fulfillment?: WebFulfillmentRequest | null;
    /** Контакты, введённые в этом оформлении: в заказ, а не в покупателя. */
    contact?: { name: string; phone: string | null };
    /**
     * Промокод и подарочный сертификат — те же, что в боте (модули coupons и
     * gift_certificates, проверка и списание в placeOrder). Баллы на сайте не
     * списываются: почту никто не подтверждает, и, введя чужую, можно было бы
     * потратить чужие баллы.
     */
    promoCode?: string | null;
    giftCode?: string | null;
    /** «Это подарок» (модуль bundles): получатель и открытка. */
    gift?: { recipient: string; message: string } | null;
    /** Подарочная упаковка к подарку (core/orders/gift-wrap). */
    giftWrap?: boolean;
    /** Ключ нажатия «оформить». Повтор той же заявки не создаёт второй заказ. */
    claimId?: string;
  } = {},
): Promise<WebPlaceResult> {
  if (payLane(ctx.tenant.settings.served_by) === "v4") {
    return placeOnV4(ctx, customer, items, countryCode, opts.claimId);
  }
  if (items.some((it) => Number(it.quantity) > WEB_MAX_QTY))
    return { ok: false, reason: "too_many" };
  // Покупатель из бота (вошёл через Telegram): его корзина в боте — не
  // корзина сайта. Откладываем её и возвращаем после оформления.
  const botCart = customer.userKey.startsWith("web_") ? null : await takeBotCart(ctx, customer);
  try {
    return await placeFromCart(ctx, customer, items, countryCode, opts);
  } finally {
    if (botCart) await restoreBotCart(ctx, customer, botCart);
  }
}

function cartProductIds(items: HandoffItem[]): string[] {
  const ids: string[] = [];
  for (const it of items) {
    if (!it.product_id) continue;
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
    for (let i = 0; i < qty; i++) ids.push(it.product_id);
  }
  return ids;
}

async function placeOnV4(
  ctx: TenantContext,
  customer: Customer,
  items: HandoffItem[],
  countryCode: string,
  claimId: string | undefined,
): Promise<WebPlaceResult> {
  if (items.some((it) => Number(it.quantity) > WEB_MAX_QTY))
    return { ok: false, reason: "too_many" };
  const ids = cartProductIds(items);
  if (ids.length === 0 || !claimId) return { ok: false, reason: "nothing_imported" };
  const { buyFromChannel } = await import("@/v4/channels/buyer");
  const { v4DbOf } = await import("@/app/admin/v4-today.server");
  const bought = await buyFromChannel(v4DbOf(ctx), {
    botId: ctx.tenant.id,
    channel: "web",
    externalId: customer.userKey,
    country: countryCode,
    productIds: ids,
    claimId: `web:${customer.userKey}:${claimId}`,
    by: "web",
  });
  if (!bought.ok) return { ok: false, reason: "order_failed" };
  return { ok: true, via: "v4", orderId: bought.orderId, no: bought.no };
}

type CartRow = { product_id: string; product_variant_id: string | null; quantity: number };

async function takeBotCart(ctx: TenantContext, customer: Customer): Promise<CartRow[]> {
  const { data, error } = await ctx.db
    .from("cart_items")
    .select("product_id, product_variant_id, quantity")
    .eq("telegram_id", customer.telegramId)
    .order("created_at")
    .order("id");
  if (error) throw serverFailure(`cart: ${error.message}`);
  return data ?? [];
}

async function restoreBotCart(
  ctx: TenantContext,
  customer: Customer,
  rows: CartRow[],
): Promise<void> {
  await clearCart(ctx, customer);
  if (rows.length === 0) return;
  const { error } = await ctx.db.from("cart_items").insert(
    rows.map((r) => ({
      bot_id: ctx.tenant.id,
      telegram_id: customer.telegramId,
      user_key: customer.userKey,
      product_id: r.product_id,
      product_variant_id: r.product_variant_id,
      quantity: r.quantity,
    })),
  );
  if (error) console.error(`[web-order:${ctx.tenant.id}] корзина бота не вернулась`, error.message);
}

async function placeFromCart(
  ctx: TenantContext,
  customer: Customer,
  items: HandoffItem[],
  countryCode: string,
  opts: Parameters<typeof placeWebOrder>[4] = {},
): Promise<WebPlaceResult> {
  await clearCart(ctx, customer);
  if ((await importItems(ctx, customer, items)) === 0)
    return { ok: false, reason: "nothing_imported" };
  const cart = await listCart(ctx, customer);
  const discounts = {
    ...(opts.promoCode?.trim() ? { promoCode: opts.promoCode.trim() } : {}),
    ...(opts.giftCode?.trim() ? { giftCode: opts.giftCode.trim() } : {}),
    ...(opts.gift ? { gift: opts.gift, giftWrap: Boolean(opts.giftWrap) } : {}),
  };
  let r: PlaceOrderResult;
  if (!cart.some((it) => it.products?.fulfillment_kind === "physical")) {
    r = await placeOrder(ctx, customer, countryCode, discounts);
  } else {
    const f = await resolveWebFulfillment(ctx, customer, opts.fulfillment, countryCode);
    if (!f.ok) {
      await clearCart(ctx, customer);
      return f;
    }
    r = await placeOrder(ctx, customer, countryCode, { ...discounts, fulfillment: f.input });
  }
  if (!r.ok || !opts.contact) return r;
  const patch = {
    display_name: opts.contact.name.slice(0, 64),
    contact: opts.contact.phone,
  };
  const named = await ctx.db.from("orders").update(patch).eq("id", r.order.id);
  // Заказ уже оформлен: сбой имени и телефона не отменяет его, но виден в журнале.
  if (named.error) console.error("[web-order] контакт не записан", named.error.message);
  return { ...r, order: { ...r.order, ...patch } };
}

/** «Отправка» материалов покупателю с сайта: они уже на странице заказа. */
export const webMaterialSender: MaterialSender = async () => "sent";

export function deliverWebOrder(
  ctx: TenantContext,
  orderId: number,
  actor?: string,
): Promise<DeliverResult> {
  // Спросить язык негде — при нескольких языках отдаём все.
  return deliverOrder(ctx, orderId, webMaterialSender, {
    lang: ctx.tenant.settings.default_locale ?? "ru",
    allWhenAmbiguous: true,
    ...(actor ? { actor } : {}),
  });
}
