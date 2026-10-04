import type { StoreProduct } from "@/core/storefront/catalog";
import { cleanLabel } from "./shops";

/**
 * Поиск товаров по площадке (В8): чистые правила снимка. В снимок идёт то, что покупатель
 * видит и может купить на витрине магазина сейчас; цена в нём — «на момент» обновления.
 */
export const MARKET_ITEMS_PAGE = 24;
/** Сколько товаров одного магазина берём в снимок за проход; больше — сообщаем в итоге крона. */
export const ITEMS_PER_SHOP_MAX = 1000;
const DESCRIPTION_CHARS = 200;
const WORDS_MAX = 5;

export type MarketItem = {
  id: string;
  shopId: string;
  shopSlug: string;
  shopName: string;
  name: string;
  price: number;
  currency: string;
  image: string | null;
  /** Когда снят снимок цены (ISO). */
  at: string;
};

/** Строка таблицы `marketplace_items` из товара витрины. */
export function itemRow(botId: string, p: StoreProduct, at: string) {
  const text = `${p.name} ${p.description}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, p.name.length + 1 + DESCRIPTION_CHARS)
    .toLowerCase();
  return {
    bot_id: botId,
    product_id: p.id,
    name: p.name,
    search_text: text,
    price: p.price,
    currency: p.currency,
    image: p.images[0] ?? null,
    updated_at: at,
  };
}

/** Слова запроса: чистые, строчные, не короче двух знаков, не больше пяти. */
export function searchWords(raw: unknown): string[] {
  return cleanLabel(raw)
    .toLowerCase()
    .split(" ")
    .filter((w) => w.length >= 2)
    .slice(0, WORDS_MAX);
}
