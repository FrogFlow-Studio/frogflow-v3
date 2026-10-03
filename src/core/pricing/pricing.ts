import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  convertViaUsd,
  convertViaUsdExact,
  manualCountryPrice,
  type Money,
} from "@/core/money/money";
import type { Json } from "@/core/db-types";
import { serverFailure } from "@/lib/server-failure";

/**
 * Цена товара для конкретного покупателя — одна функция на все каналы.
 *
 * Правила задаёт продавец в админке:
 *  1. есть ручная цена страны — берём её, она в валюте этой страны;
 *  2. нет — переводим базовую цену по курсу в валюту страны;
 *  3. страна ещё неизвестна — считаем по стране продавца, а НЕ по базовой
 *     цене (базовая у клиентов намеренно завышена под конвертацию).
 * Модуль multi_currency выключен → всегда базовая цена в базовой валюте.
 */
export type PricedProduct = {
  /** id товара — для ограниченных предложений (core/offers); без него скидка не ищется. */
  id?: string;
  price: number | string;
  currency?: string | null;
  country_prices?: Json | null;
};

type Methods = { currencies: Map<string, string>; defaultCode: string | null };

const methodsCache = new Map<string, { ts: number; methods: Methods }>();
const METHODS_TTL_MS = 5 * 60 * 1000;

async function loadMethods(ctx: TenantContext): Promise<Methods> {
  const cached = methodsCache.get(ctx.tenant.id);
  if (cached && Date.now() - cached.ts < METHODS_TTL_MS) return cached.methods;
  const { data, error } = await ctx.db
    .from("payment_methods")
    .select("country_code, currency, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("country_code", { ascending: true });
  // Пустой ответ при сбое пять минут держался бы в кэше: цены в чужой валюте.
  if (error) throw serverFailure(`Способы оплаты: ${error.message}`);
  const currencies = new Map<string, string>();
  let defaultCode: string | null = null;
  for (const row of data ?? []) {
    const code = row.country_code?.toUpperCase();
    if (!code) continue;
    if (!currencies.has(code)) currencies.set(code, row.currency || "KZT");
    if (!defaultCode && code !== "OTHER") defaultCode = code;
  }
  const methods = { currencies, defaultCode };
  methodsCache.set(ctx.tenant.id, { ts: Date.now(), methods });
  return methods;
}

export function resetPricingCache(): void {
  methodsCache.clear();
  fxMemory = null;
  fxRetryAt = 0;
}

export async function currencyForCountry(
  ctx: TenantContext,
  code: string | null | undefined,
): Promise<string | null> {
  if (!code) return null;
  return (await loadMethods(ctx)).currencies.get(code.toUpperCase()) ?? null;
}

export async function defaultCountryCode(ctx: TenantContext): Promise<string | null> {
  return (await loadMethods(ctx)).defaultCode;
}

/**
 * Курсы к USD: open.er-api.com, кеш в памяти на 10 минут — общий на всех
 * арендаторов, курс один. Сбой API при устаревшем кеше — считаем по старому
 * курсу (как v1) и пробуем снова не раньше чем через минуту. Сверка чека
 * по курсу старше суток не идёт — там ошибка стоит денег, решает продавец.
 */
let fxMemory: { ts: number; rates: Record<string, number> } | null = null;
let fxRetryAt = 0;
const FX_TTL_MS = 10 * 60 * 1000;
const FX_RETRY_MS = 60 * 1000;
/** Для сверки чека курс старше суток не годится: чек смотрит продавец. */
const FX_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type FxProvider = () => Promise<Record<string, number>>;

export const defaultFxProvider: FxProvider = async () => {
  const r = await fetch("https://open.er-api.com/v6/latest/USD", {
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`FX api ${r.status}`);
  const j = (await r.json()) as { result?: string; rates?: Record<string, number> };
  if (j.result !== "success" || !j.rates) throw new Error("FX api bad payload");
  return j.rates;
};

let fxProvider: FxProvider = defaultFxProvider;
export function setFxProvider(p: FxProvider): void {
  fxProvider = p;
  fxMemory = null;
  fxRetryAt = 0;
}

export async function convertForTenant(
  amount: number,
  from: string,
  to: string,
): Promise<number | null> {
  return convertAmount(amount, from, to);
}

/** Перевод суммы для сверки чека: до копеек, без округления до целого. */
export async function convertForReceipt(
  amount: number,
  from: string,
  to: string,
): Promise<number | null> {
  return convertAmount(amount, from, to, true);
}

async function convertAmount(
  amount: number,
  from: string,
  to: string,
  exact = false,
): Promise<number | null> {
  if (from.toUpperCase() === to.toUpperCase()) return exact ? amount : Math.round(amount);
  let rates = await fxRates();
  if (exact && fxMemory && Date.now() - fxMemory.ts > FX_RECEIPT_MAX_AGE_MS) rates = null;
  return rates ? (exact ? convertViaUsdExact : convertViaUsd)(amount, from, to, rates) : null;
}

async function fxRates(): Promise<Record<string, number> | null> {
  const now = Date.now();
  if (fxMemory && (now - fxMemory.ts <= FX_TTL_MS || now < fxRetryAt)) return fxMemory.rates;
  try {
    fxMemory = { ts: now, rates: await fxProvider() };
    return fxMemory.rates;
  } catch (e) {
    fxRetryAt = now + FX_RETRY_MS;
    console.warn(
      fxMemory ? "[pricing] курс недоступен, считаем по прошлому" : "[pricing] курс недоступен",
      e,
    );
    return fxMemory?.rates ?? null;
  }
}

export async function resolvePrice(
  ctx: TenantContext,
  product: PricedProduct,
  countryCode: string | null | undefined,
  variant?: { price: number | string } | null,
): Promise<Money> {
  const money = await resolveListPrice(ctx, product, countryCode, variant);
  if (!ctx.tenant.modules.limited_offers || !product.id) return money;
  const { applyOffer, offerForProduct } = await import("@/core/offers/offers");
  const offer = await offerForProduct(ctx, product.id);
  return offer ? { ...money, amount: applyOffer(money.amount, offer.percent) } : money;
}

/** Цена без акций — по стране и курсу. */
export async function resolveListPrice(
  ctx: TenantContext,
  product: PricedProduct,
  countryCode: string | null | undefined,
  variant?: { price: number | string } | null,
): Promise<Money> {
  const base = Number(variant ? variant.price : product.price) || 0;
  const baseCurrency = String(product.currency || "KZT").toUpperCase();
  if (!ctx.tenant.modules.multi_currency)
    return { amount: Math.round(base), currency: baseCurrency };

  const code = (countryCode || (await defaultCountryCode(ctx)) || "").toUpperCase();
  if (!code) return { amount: Math.round(base), currency: baseCurrency };
  const currency = (await currencyForCountry(ctx, code)) || baseCurrency;

  if (!variant) {
    const manual = manualCountryPrice(product.country_prices, code);
    if (manual !== null) return { amount: Math.round(manual), currency };
  }
  if (currency === baseCurrency) return { amount: Math.round(base), currency };
  const converted = await convertAmount(base, baseCurrency, currency);
  // Курс недоступен — честная базовая цена в своей валюте безопаснее чужой
  // цифры под чужим ярлыком.
  if (converted === null) return { amount: Math.round(base), currency: baseCurrency };
  return { amount: converted, currency };
}
