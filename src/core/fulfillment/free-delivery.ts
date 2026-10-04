import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingsStrict, setSetting } from "@/core/settings/settings";
import { shopCurrency, toOrderCurrency } from "@/core/discounts/discounts";

/**
 * Бесплатная доставка от суммы. Два вида порога, оба в валюте магазина
 * (`shop_currency`) и оба в `app_settings` (схема не меняется):
 *   delivery_free_from   — общий порог; 0 или пусто — нет;
 *   delivery_free_zones  — JSON {id зоны: порог}; порог зоны важнее общего.
 * Порог сравнивается с суммой товаров ПОСЛЕ скидок (промокод и баллы, как в
 * корзине; подарочный сертификат — оплата, а не скидка, на порог не влияет),
 * без доставки: сумма ≥ порога — доставка стоит 0. Решает placeOrder на
 * сервере, адаптеры каналов только показывают, сколько добрать.
 */
export const FREE_FROM_KEY = "delivery_free_from";
export const FREE_ZONES_KEY = "delivery_free_zones";
export const FREE_MAX = 100_000_000;

export type FreeDeliveryRules = { general: number; zones: Record<string, number> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFreeFrom(raw: string | null | undefined): number {
  const n = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= FREE_MAX ? n : 0;
}

export function parseFreeZones(raw: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    const v = JSON.parse(raw ?? "{}") as unknown;
    if (v && typeof v === "object" && !Array.isArray(v))
      for (const [id, n] of Object.entries(v)) {
        const amount = parseFreeFrom(String(n));
        if (UUID.test(id) && amount > 0) out[id.toLowerCase()] = amount;
      }
  } catch {
    /* битое значение — порогов зон нет */
  }
  return out;
}

/** Пороги магазина. Сбой чтения — сбой, а не «порога нет» (иначе заказ уйдёт с платной доставкой молча). */
export async function loadFreeDeliveryRules(ctx: TenantContext): Promise<FreeDeliveryRules> {
  const s = await getSettingsStrict(ctx, [FREE_FROM_KEY, FREE_ZONES_KEY]);
  return { general: parseFreeFrom(s[FREE_FROM_KEY]), zones: parseFreeZones(s[FREE_ZONES_KEY]) };
}

export async function saveFreeDeliveryRules(
  ctx: TenantContext,
  rules: FreeDeliveryRules,
  validZoneIds: readonly string[],
): Promise<void> {
  const valid = new Set(validZoneIds.map((id) => id.toLowerCase()));
  const zones: Record<string, number> = {};
  for (const [id, n] of Object.entries(rules.zones)) {
    const amount = parseFreeFrom(String(n));
    if (valid.has(id.toLowerCase()) && amount > 0) zones[id.toLowerCase()] = amount;
  }
  await setSetting(ctx, FREE_FROM_KEY, String(parseFreeFrom(String(rules.general))));
  await setSetting(ctx, FREE_ZONES_KEY, JSON.stringify(zones));
}

/** Порог для зоны в валюте магазина: порог зоны, иначе общий; 0 — бесплатной доставки нет. */
export function thresholdFor(rules: FreeDeliveryRules, zoneId: string | null | undefined): number {
  const own = zoneId ? rules.zones[zoneId.toLowerCase()] : undefined;
  return own ?? rules.general;
}

export type FreeDeliveryStatus = {
  /** Порог в валюте заказа. */
  threshold: number;
  /** Сколько добрать (округлено вверх); 0 — доставка бесплатная. */
  remaining: number;
  free: boolean;
  currency: string;
};

/**
 * Где сумма относительно порога. `goods` — товары после скидок в валюте
 * заказа. Порога нет, курса нет (сравнить нечем) или сумма ноль — null:
 * бесплатной доставки не обещаем.
 */
export async function freeDeliveryStatus(
  ctx: TenantContext,
  rules: FreeDeliveryRules,
  zoneId: string | null | undefined,
  goods: { amount: number; currency: string },
): Promise<FreeDeliveryStatus | null> {
  const base = thresholdFor(rules, zoneId);
  if (base <= 0 || !(goods.amount > 0)) return null;
  const threshold = await toOrderCurrency(base, await shopCurrency(ctx), goods.currency);
  if (threshold === null) return null;
  const free = goods.amount >= threshold;
  return {
    threshold,
    remaining: free ? 0 : Math.ceil(threshold - goods.amount),
    free,
    currency: goods.currency,
  };
}

/** Сумма товаров после скидок для порога: промокод и баллы вычитаются, сертификат — нет. */
export function goodsAfterDiscounts(sum: {
  subtotal: number;
  promo: { discount: number } | null;
  points: { discount: number };
}): number {
  return Math.max(0, sum.subtotal - (sum.promo?.discount ?? 0) - sum.points.discount);
}
