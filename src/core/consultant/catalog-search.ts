/**
 * Поиск консультанта по каталогу (перенос search_products из v1, консультант
 * BOVI). Чисто: товары приходят списком, база и цены — в catalog-tool.server.
 *
 * Зачем: большой каталог (у BOVI ~880 позиций) не влезает в подсказку, и
 * первые 120 строк отвечали за весь магазин. Модель ищет сама, инструментом,
 * а в подсказке остаётся карта ассортимента — категории, число позиций, цена «от».
 *
 * Уроки v1 (docs/inherited-knowledge.md, fix(consultant)):
 * - «140x70» и «70x140» — один размер; стороны сравниваются парой без порядка
 *   с допуском 3 см, у трёх сторон — две большие; «70 на 140» тоже размер;
 * - широкий запрос (только категория или марка, без размера и бюджета)
 *   возвращает сводку без карточек — иначе модель вываливает весь прайс;
 *   «покажите все» — show_all;
 * - в бюджетной ветке категория из запроса сужает подбор, а если в бюджет не
 *   попало ничего, называется самая дешёвая позиция той же выборки
 *   (cheapest_ignoring_price_limit) — вместо «узкого ценового сегмента».
 */

export type CatalogItem = {
  id: string;
  name: string;
  category: string | null;
  description: string;
  keywords: string;
  /** Базовая цена товара (без акций и пересчёта валют). */
  price: number;
  currency: string;
  /** null — остаток не ведётся. */
  stock: number | null;
  variants: Array<{ name: string; price: number }>;
};

export type CatalogQuery = {
  query?: string;
  category?: string;
  size?: string;
  max_price?: number;
  show_all?: boolean;
};

export type CatalogSearch = {
  total_matches: number;
  items: CatalogItem[];
  /** Широкий запрос: карточек нет, есть сводка — модель задаёт уточняющий вопрос. */
  summary?: {
    categories: string[];
    sizes: string[];
    price_from: number;
    price_to: number;
    currency: string;
  };
  /** Ничего не вошло в бюджет — самая дешёвая позиция той же выборки. */
  cheapest_ignoring_price_limit?: CatalogItem;
};

/** Карточек в ответе инструмента: больше модель всё равно не перескажет. */
export const MAX_CARDS = 8;
/** Размер совпадает с допуском в сантиметрах (v1: SIZE_TOLERANCE_CM). */
export const SIZE_TOLERANCE_CM = 3;

const STOP = new Set([
  "для",
  "как",
  "что",
  "или",
  "при",
  "под",
  "над",
  "это",
  "все",
  "про",
  "без",
  "ваш",
  "вас",
  "вам",
  "мне",
  "нам",
  "есть",
  "хочу",
  "нужен",
  "нужна",
  "нужно",
  "нужны",
  "покажите",
  "показать",
  "подскажите",
  "какие",
  "какой",
  "какая",
  "сколько",
  "стоит",
  "цена",
  "наличии",
  "наличие",
  "размер",
  "размера",
  "the",
  "and",
  "for",
  "with",
]);

const SIZE_RE =
  /(\d{2,3}(?:[.,]\d)?)\s*(?:x|х|×|\*|на)\s*(\d{2,3}(?:[.,]\d)?)(?:\s*(?:x|х|×|\*|на)\s*(\d{1,3}(?:[.,]\d)?))?/gi;

function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

/** Все размеры в тексте: каждая пара — две большие стороны по убыванию. */
export function sizesIn(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of norm(text).matchAll(SIZE_RE)) {
    const sides = [m[1], m[2], m[3]]
      .filter((x): x is string => Boolean(x))
      .map((x) => Number(x.replace(",", ".")))
      .filter((n) => n > 0)
      .sort((a, b) => b - a);
    if (sides.length >= 2) out.push([sides[0]!, sides[1]!]);
  }
  return out;
}

/** Размер товара подходит к запрошенному: пара сторон без порядка, допуск 3 см. */
export function sizeMatches(productText: string, querySize: string): boolean {
  const want = sizesIn(querySize)[0];
  if (!want) return true;
  return sizesIn(productText).some(
    ([a, b]) =>
      Math.abs(a - want[0]) <= SIZE_TOLERANCE_CM && Math.abs(b - want[1]) <= SIZE_TOLERANCE_CM,
  );
}

/** Слова запроса без размеров и служебных слов. */
export function queryTokens(text: string): string[] {
  return norm(text)
    .replace(SIZE_RE, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Основа слова: «одеяло» находит «одеяла», «полотенце» — «полотенца». */
function stem(token: string): string {
  if (token.length <= 4 || !/\p{L}/u.test(token)) return token;
  return token.slice(0, Math.max(4, token.length - 2));
}

function haystack(item: CatalogItem): { title: string; all: string } {
  const title = norm(`${item.name} ${item.category ?? ""}`);
  const all = norm(
    `${title} ${item.keywords} ${item.description} ${item.variants.map((v) => v.name).join(" ")}`,
  );
  return { title, all };
}

function itemSizeText(item: CatalogItem): string {
  return `${item.name} ${item.variants.map((v) => v.name).join(" ")}`;
}

function minPrice(item: CatalogItem): number {
  const prices = [item.price, ...item.variants.map((v) => v.price)].filter((p) => p > 0);
  return prices.length ? Math.min(...prices) : item.price;
}

const inStock = (item: CatalogItem) => item.stock == null || item.stock > 0;

/**
 * Поиск: из товаров, которые подходят по категории и размеру, берутся те, что
 * покрывают больше всего слов запроса (все слова — если такие есть). Так
 * «одеяло пуховое белое» не пустеет из-за одного слова, которого нет в карточке.
 */
export function searchCatalog(items: readonly CatalogItem[], q: CatalogQuery): CatalogSearch {
  const text = q.query ?? "";
  const size = q.size?.trim() || (sizesIn(text).length ? text : "");
  const tokens = queryTokens(text);
  const catTokens = q.category ? queryTokens(q.category) : [];

  const inCategory = items.filter((it) => {
    if (!catTokens.length) return true;
    const cat = norm(`${it.category ?? ""} ${it.name}`);
    return catTokens.every((t) => cat.includes(stem(t)));
  });
  const sized = size ? inCategory.filter((it) => sizeMatches(itemSizeText(it), size)) : inCategory;

  const scored = sized.map((it) => {
    const h = haystack(it);
    let hits = 0;
    let score = 0;
    for (const t of tokens) {
      const s = stem(t);
      if (h.title.includes(s)) {
        hits++;
        score += 3;
      } else if (h.all.includes(s)) {
        hits++;
        score += 1;
      }
    }
    return { it, hits, score };
  });
  const best = tokens.length ? Math.max(0, ...scored.map((x) => x.hits)) : 0;
  const matched = tokens.length ? (best > 0 ? scored.filter((x) => x.hits === best) : []) : scored;

  const budget = q.max_price && q.max_price > 0 ? q.max_price : null;
  const inBudget = budget ? matched.filter((x) => minPrice(x.it) <= budget) : matched;
  const ordered = [...inBudget].sort(
    (a, b) =>
      Number(inStock(b.it)) - Number(inStock(a.it)) ||
      b.score - a.score ||
      minPrice(a.it) - minPrice(b.it),
  );

  const result: CatalogSearch = { total_matches: ordered.length, items: [] };
  if (budget && !ordered.length && matched.length) {
    result.cheapest_ignoring_price_limit = [...matched]
      .filter((x) => inStock(x.it))
      .sort((a, b) => minPrice(a.it) - minPrice(b.it))[0]?.it;
  }

  const broad = !size && !budget && !q.show_all && ordered.length > MAX_CARDS;
  if (broad) {
    const prices = ordered.map((x) => minPrice(x.it)).filter((p) => p > 0);
    const sizes = new Set<string>();
    for (const x of ordered)
      for (const [a, b] of sizesIn(itemSizeText(x.it))) if (sizes.size < 15) sizes.add(`${b}x${a}`);
    result.summary = {
      categories: [...new Set(ordered.map((x) => x.it.category).filter(Boolean) as string[])].slice(
        0,
        10,
      ),
      sizes: [...sizes],
      price_from: prices.length ? Math.min(...prices) : 0,
      price_to: prices.length ? Math.max(...prices) : 0,
      currency: ordered[0]!.it.currency,
    };
    return result;
  }
  result.items = ordered.slice(0, q.show_all ? MAX_CARDS * 3 : MAX_CARDS).map((x) => x.it);
  return result;
}

/**
 * Карта ассортимента для подсказки: строка на категорию — сколько позиций в
 * наличии и цена «от». Модель знает, что вообще продаётся, а конкретику берёт
 * поиском.
 */
export function assortmentMap(items: readonly CatalogItem[], maxLines = 80): string {
  const groups = new Map<string, { count: number; from: number; currency: string }>();
  for (const it of items) {
    if (!inStock(it)) continue;
    const key = it.category?.trim() || "Без категории";
    const g = groups.get(key) ?? {
      count: 0,
      from: Number.POSITIVE_INFINITY,
      currency: it.currency,
    };
    g.count++;
    const p = minPrice(it);
    if (p > 0 && p < g.from) g.from = p;
    groups.set(key, g);
  }
  const lines = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(
      ([name, g]) =>
        `- ${name}: ${g.count} поз.${Number.isFinite(g.from) ? `, от ${g.from} ${g.currency}` : ""}`,
    );
  const extra = lines.length > maxLines ? `\n… и ещё ${lines.length - maxLines} категорий` : "";
  return lines.slice(0, maxLines).join("\n") + extra;
}
