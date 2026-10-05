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

/** Слова текста: буквы и цифры любого языка. */
function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Расстояние Левенштейна; дальше `max` не считаем (возвращает max + 1). */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Слово короче этого точно: опечатку в коротком слове не угадать, ищем только как есть. */
export const FUZZY_MIN_LENGTH = 5;

/** Сколько ошибок прощаем слову: 1 для 5–8 знаков, 2 для длиннее. */
export function typoBudget(word: string): number {
  return word.length < FUZZY_MIN_LENGTH ? 0 : word.length >= 9 ? 2 : 1;
}

/**
 * Слово запроса «почти есть» в тексте: найдётся слово текста (или его начало такой же длины),
 * отличающееся не больше, чем на допуск. «клубнику» находит «клубникой», «медовк» — «медовик».
 */
export function nearWord(word: string, text: string): boolean {
  const max = typoBudget(word);
  if (max === 0) return text.includes(word);
  for (const tok of tokens(text)) {
    for (const len of [word.length - 1, word.length, word.length + 1]) {
      if (len < 1 || len > tok.length) continue;
      if (editDistance(word, tok.slice(0, len), max) <= max) return true;
    }
  }
  return false;
}

/** Каждое слово запроса есть в тексте товара или в названии и категории магазина (точно или с опечаткой). */
export function matchesAll(
  words: readonly string[],
  itemText: string,
  shopText: string,
  fuzzy: boolean,
): boolean {
  const text = itemText.toLowerCase();
  const shop = shopText.toLowerCase();
  return words.every((w) =>
    fuzzy
      ? text.includes(w) || shop.includes(w) || nearWord(w, text) || nearWord(w, shop)
      : text.includes(w) || shop.includes(w),
  );
}
