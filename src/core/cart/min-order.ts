import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingStrict, setSetting } from "@/core/settings/settings";
import { shopCurrency, toOrderCurrency } from "@/core/discounts/discounts";

/**
 * Минимальная сумма заказа: настройка магазина `app_settings.min_order_amount`
 * в валюте магазина (shop_currency), 0 или пусто — без минимума. Правило одно
 * на все каналы (бот, сайт, Instagram/WhatsApp): его проверяет placeOrder на
 * сервере, а адаптеры только показывают, сколько добрать (belowMinimum).
 *
 * Считается сумма корзины до скидок. Корзина на 0 (бесплатный товар) под
 * минимум не попадает: бесплатное не должно упираться в сумму. Подарочный
 * сертификат покупается отдельным путём (core/storefront/gift-order), а не
 * корзиной, и этого правила не касается. Курса нет — сравнить нечем, заказ
 * не блокируется.
 */
export const MIN_ORDER_KEY = "min_order_amount";
export const MIN_ORDER_MAX = 100_000_000;

export function parseMinOrder(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= MIN_ORDER_MAX ? n : 0;
}

/** Минимум в валюте магазина; 0 — не задан. Сбой чтения — сбой, а не «минимума нет». */
export async function loadMinOrder(ctx: TenantContext): Promise<number> {
  return parseMinOrder(await getSettingStrict(ctx, MIN_ORDER_KEY));
}

export async function saveMinOrder(ctx: TenantContext, amount: number): Promise<void> {
  await setSetting(ctx, MIN_ORDER_KEY, String(parseMinOrder(String(amount))));
}

export type BelowMinimum = {
  /** Минимум в валюте заказа. */
  min: number;
  /** Сколько добрать до минимума. */
  shortfall: number;
  currency: string;
};

/** Корзина меньше минимума — на сколько; `null` — можно оформлять. */
export async function belowMinimum(
  ctx: TenantContext,
  priced: { total: number; currency: string },
): Promise<BelowMinimum | null> {
  if (!(priced.total > 0)) return null;
  const min = await loadMinOrder(ctx);
  if (min === 0) return null;
  const inOrder = await toOrderCurrency(min, await shopCurrency(ctx), priced.currency);
  if (inOrder === null || !(inOrder > priced.total)) return null;
  return { min: inOrder, shortfall: Math.ceil(inOrder - priced.total), currency: priced.currency };
}
