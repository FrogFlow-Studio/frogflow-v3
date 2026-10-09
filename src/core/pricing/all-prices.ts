import type { TenantContext } from "@/core/tenant/resolve.server";
import { formatMoney, type Money } from "@/core/money/money";
import { getSetting } from "@/core/settings/settings";
import { listCart, priceCart } from "@/core/cart/cart";
import type { Customer } from "@/core/customers/customers";
import { payCountries, strikePrice, resolvePrice, type PricedProduct } from "./pricing";

/**
 * Цены во всех валютах оплаты сразу: «1500 ₸ / 490 ₽» (Копилка Русоведа,
 * 09.10). Покупатель видит свою цену до выбора страны, а валюта решается на
 * шаге оплаты — тем же выбором страны, что и раньше, только с суммами.
 *
 * Включает продавец в «Способах оплаты» (`card_all_prices`); работает при
 * модуле multi_currency и 2–3 разных валютах оплаты: у магазинов с пятью-семью
 * странами строка из семи цен не читается, там остаётся одна цена.
 */
export const CARD_ALL_PRICES_KEY = "card_all_prices";
export const ALL_PRICES_MAX = 3;

/**
 * Страны, по которым показывать цены, — по одной на валюту, в порядке
 * способов оплаты. null — показывать одну цену, как раньше.
 */
export async function allPriceCountries(ctx: TenantContext): Promise<string[] | null> {
  if (!ctx.tenant.modules.multi_currency) return null;
  // Мягкое чтение: сбой базы — одна цена, как без настройки; заказ считается отдельно.
  if ((await getSetting(ctx, CARD_ALL_PRICES_KEY)) !== "true") return null;
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const { code, currency } of await payCountries(ctx)) {
    if (seen.has(currency)) continue;
    seen.add(currency);
    codes.push(code);
  }
  return codes.length >= 2 && codes.length <= ALL_PRICES_MAX ? codes : null;
}

export type CountryPrice = { country: string; price: Money; old: number | null };

/**
 * Цена товара в каждой валюте оплаты (со скидкой по акции и прежней ценой);
 * с вариантами — самая низкая по каждой стране («от …»). null — одна цена.
 */
export async function allCountryPrices(
  ctx: TenantContext,
  product: PricedProduct,
  variants: readonly { price: number | string }[] = [],
): Promise<CountryPrice[] | null> {
  const countries = await allPriceCountries(ctx);
  if (!countries) return null;
  return Promise.all(
    countries.map(async (country): Promise<CountryPrice> => {
      if (variants.length === 0) return { country, ...(await strikePrice(ctx, product, country)) };
      const priced = await Promise.all(variants.map((v) => resolvePrice(ctx, product, country, v)));
      const min = priced.reduce((a, b) => (b.amount < a.amount ? b : a));
      return { country, price: min, old: null };
    }),
  );
}

/** «1500 ₸ / 490 ₽». */
export function formatPriceList(list: readonly { price: Money }[]): string {
  return list.map(({ price }) => formatMoney(price.amount, price.currency)).join(" / ");
}

/**
 * Шаг оплаты при ценах во всех валютах: сумма корзины для каждой страны
 * оплаты («Казахстан — 1500 ₸», «Россия — 490 ₽»). Без доставки, промокода и
 * баллов — точная сумма приходит в заказе. null — спрашивать страну как раньше;
 * страны без суммы (корзина в разных валютах) остаются без неё.
 */
export async function payChoiceTotals(
  ctx: TenantContext,
  customer: Customer,
): Promise<Map<string, Money> | null> {
  if (!(await allPriceCountries(ctx))) return null;
  const items = await listCart(ctx, customer);
  if (items.length === 0) return null;
  const out = new Map<string, Money>();
  for (const { code } of await payCountries(ctx)) {
    const priced = await priceCart(ctx, items, code);
    if (priced.lines.length > 0 && !priced.mixedCurrency)
      out.set(code, { amount: priced.total, currency: priced.currency });
  }
  return out;
}

/** Цифровая корзина: валюту выбирают на шаге оплаты; в физической доставка уже посчитана по стране. */
export async function payAtLastStep(ctx: TenantContext, customer: Customer): Promise<boolean> {
  if (!(await allPriceCountries(ctx))) return false;
  const items = await listCart(ctx, customer);
  return items.length > 0 && items.every((i) => i.products?.fulfillment_kind !== "physical");
}
