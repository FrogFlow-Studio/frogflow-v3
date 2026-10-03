import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { getSettingsStrict } from "@/core/settings/settings";
import { currencyForCountry, defaultCountryCode, convertForTenant } from "@/core/pricing/pricing";
import type { Money } from "@/core/money/money";
import { amountDue, type PaymentMode } from "./pure";

export type FulfillmentSettings = {
  pickup: boolean;
  delivery: boolean;
  paymentMode: PaymentMode;
  depositPercent: number;
};

export async function fulfillmentSettings(ctx: TenantContext): Promise<FulfillmentSettings> {
  const s = await getSettingsStrict(ctx, [
    "fulfillment_pickup_enabled",
    "fulfillment_delivery_enabled",
    "payment_mode",
    "deposit_percent",
  ]);
  const raw = Number(s.deposit_percent);
  return {
    pickup: s.fulfillment_pickup_enabled !== "false",
    delivery: s.fulfillment_delivery_enabled !== "false",
    paymentMode:
      s.payment_mode === "deposit" || s.payment_mode === "on_receipt" ? s.payment_mode : "full",
    depositPercent: Number.isFinite(raw) && raw >= 1 && raw <= 100 ? raw : 30,
  };
}

export async function amountDueNow(
  ctx: TenantContext,
  order: { total: number; fulfillment_kind: string },
): Promise<number> {
  if (order.fulfillment_kind !== "physical") return order.total;
  const s = await fulfillmentSettings(ctx);
  return amountDue(order.total, s.paymentMode, s.depositPercent);
}

export async function maxLeadTimeDaysInCart(
  ctx: TenantContext,
  customer: Customer,
): Promise<number> {
  const { data, error: dataError } = await ctx.db
    .from("cart_items")
    .select("products(lead_time_days)")
    .eq("telegram_id", customer.telegramId);
  if (dataError) throw serverFailure(`Выдача: ${dataError.message}`);
  let max = 0;
  for (const row of data ?? []) {
    const d = row.products?.lead_time_days;
    if (typeof d === "number" && d > max) max = d;
  }
  return max;
}

export type DeliveryZone = { id: string; name: string; price: number };

export async function activeDeliveryZones(ctx: TenantContext): Promise<DeliveryZone[]> {
  const { data, error: dataError } = await ctx.db
    .from("delivery_zones")
    .select("id, name, price")
    .eq("is_active", true)
    .order("sort_order");
  if (dataError) throw serverFailure(`Выдача: ${dataError.message}`);
  return (data ?? []).map((z) => ({ id: z.id, name: z.name, price: Number(z.price) || 0 }));
}

/**
 * Комиссия зоны в валюте покупателя. Цена зоны задана в домашней валюте
 * продавца (валюта первой страны в реквизитах) и конвертируется тем же
 * курсом, что цены товаров; курс недоступен — остаёмся в домашней валюте.
 */
export async function zoneFee(
  ctx: TenantContext,
  zonePrice: number,
  countryCode: string | null | undefined,
): Promise<Money> {
  const home = (await currencyForCountry(ctx, await defaultCountryCode(ctx))) || "KZT";
  if (!ctx.tenant.modules.multi_currency)
    return { amount: Math.round(zonePrice) || 0, currency: home };
  const code = (countryCode || (await defaultCountryCode(ctx)) || "").toUpperCase();
  const currency = (code && (await currencyForCountry(ctx, code))) || home;
  if (currency === home) return { amount: Math.round(zonePrice) || 0, currency: home };
  const converted = await convertForTenant(zonePrice, home, currency);
  return converted === null
    ? { amount: Math.round(zonePrice) || 0, currency: home }
    : { amount: converted, currency };
}

/** Списание остатка CAS'ом; null — остаток не отслеживается. */
export async function decrementStock(
  ctx: TenantContext,
  productId: string,
  qty: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: p, error: pError } = await ctx.db
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .maybeSingle();
    if (pError) throw serverFailure(`Выдача: ${pError.message}`);
    if (!p || p.stock_quantity === null) return true;
    if (p.stock_quantity < qty) return false;
    const { data, error: dataError } = await ctx.db
      .from("products")
      .update({ stock_quantity: p.stock_quantity - qty })
      .eq("id", productId)
      .eq("stock_quantity", p.stock_quantity)
      .select("id")
      .maybeSingle();
    if (dataError) throw serverFailure(`Выдача: ${dataError.message}`);
    if (data) return true;
  }
  return false;
}

export async function restoreStock(
  ctx: TenantContext,
  productId: string,
  qty: number,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: p, error: pError } = await ctx.db
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .maybeSingle();
    if (pError) throw serverFailure(`Выдача: ${pError.message}`);
    if (!p || p.stock_quantity === null) return;
    const { data, error: dataError } = await ctx.db
      .from("products")
      .update({ stock_quantity: p.stock_quantity + qty })
      .eq("id", productId)
      .eq("stock_quantity", p.stock_quantity)
      .select("id")
      .maybeSingle();
    if (dataError) throw serverFailure(`Выдача: ${dataError.message}`);
    if (data) {
      // Возврат выше порога снимает отметку «заканчивается»; сбой сюда не относится.
      await (
        await import("@/core/catalog/low-stock")
      )
        .resetLowStock(ctx, productId)
        .catch(() => {});
      return;
    }
  }
}

/**
 * Вернуть на склад всё, что списал заказ (placeOrder списывает при модуле
 * «Склад»). Для отклонённых и просроченных заказов с сайта: оформить их может
 * кто угодно, и без возврата пачка брошенных заказов обнулила бы остатки.
 */
export async function restoreOrderStock(ctx: TenantContext, orderId: number): Promise<number> {
  if (!ctx.tenant.modules.stock) return 0;
  const { data, error: dataError } = await ctx.db
    .from("order_items")
    .select("product_id, quantity")
    .eq("order_id", orderId);
  if (dataError) throw serverFailure(`Выдача: ${dataError.message}`);
  let n = 0;
  for (const it of data ?? []) {
    if (!it.product_id) continue;
    await restoreStock(ctx, it.product_id, Number(it.quantity) || 0);
    n++;
  }
  return n;
}

/**
 * Дописать внесённую сумму к paid_amount CAS'ом по старому значению: два
 * одновременных «Внести оплату» не теряют друг друга. Сумма, с которой
 * внесённое превысит total, не пишется совсем (как в v1): обрезка молча
 * теряла бы разницу, а в журнале осталась бы полная сумма. Копейка
 * округления — не переплата, такой остаток доводится ровно до total.
 * false — заказа нет, переплата или CAS не сошёлся за пять попыток.
 */
export async function recordPayment(
  ctx: TenantContext,
  orderId: number,
  amount: number,
): Promise<boolean> {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: order, error: orderError } = await ctx.db
      .from("orders")
      .select("paid_amount, total")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw serverFailure(`Выдача: ${orderError.message}`);
    if (!order) return false;
    const current = Number(order.paid_amount) || 0;
    const total = Number(order.total);
    const sum = Math.round((current + amount) * 100) / 100;
    if (sum > total + 0.01) return false;
    const next = Math.min(total, sum);
    const { data: updated, error: updatedError } = await ctx.db
      .from("orders")
      .update({ paid_amount: next })
      .eq("id", orderId)
      .eq("paid_amount", current)
      .select("id")
      .maybeSingle();
    if (updatedError) throw serverFailure(`Выдача: ${updatedError.message}`);
    if (updated) return true;
  }
  return false;
}
