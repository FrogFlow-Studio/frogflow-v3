/**
 * Каталог магазинов площадки (В7): чистые правила без базы. Строка каталога —
 * снимок, который раз в час собирает крон (`shops.server.ts`); здесь — как из
 * оценок товаров получается оценка магазина и как чистится поисковая строка.
 */
export const MARKET_PAGE = 24;
const TEXT_MAX = 60;

export type MarketShop = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city: string;
  /** Средняя оценка 1–5 с двумя знаками; нет оценок — null. */
  rating: number | null;
  ratingCount: number;
  /** Оплаченных заказов за 30 дней, округлённо (roundOrders); 0 — меньше десяти. */
  ordersMonth: number;
  /** Когда магазин на FrogFlow (ISO); null — не знаем. */
  since: string | null;
};

/** Заказ для карточки — оплаченный: ждущие оплаты, отменённые и отклонённые не считаются. */
export const MARKET_ORDER_STATUSES = [
  "paid",
  "accepted",
  "in_production",
  "ready",
  "delivering",
  "delivered",
] as const;

/**
 * Число заказов в карточке — округлённое вниз, чтобы не выдавать точные обороты:
 * меньше 10 — 0 (карточка не хвастается), до 100 — десятки, до 1000 — полсотни, дальше — сотни.
 */
export function roundOrders(n: number): number {
  if (!Number.isFinite(n) || n < 10) return 0;
  if (n < 100) return Math.floor(n / 10) * 10;
  if (n < 1000) return Math.floor(n / 50) * 50;
  return Math.floor(n / 100) * 100;
}

/**
 * Оценка магазина — среднее по оценкам всех его товаров, взвешенное числом оценок
 * (товар с 50 оценками весит больше товара с одной). Нет оценок — null, не 0.
 */
export function shopRating(products: Array<{ rating_avg: number | null; rating_count: number }>): {
  rating: number | null;
  count: number;
} {
  let sum = 0;
  let count = 0;
  for (const p of products) {
    if (p.rating_avg == null || !(p.rating_count > 0)) continue;
    sum += p.rating_avg * p.rating_count;
    count += p.rating_count;
  }
  return count > 0
    ? { rating: Math.round((sum / count) * 100) / 100, count }
    : { rating: null, count: 0 };
}

/** Подпись для фильтра или поиска: без управляющих символов запроса, не длиннее 60 знаков. */
export function cleanLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[%_\\,()*"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TEXT_MAX);
}

/** Сколько раз встречается каждое значение: по убыванию, при равенстве — по алфавиту. */
export function tally(values: string[]): Array<{ value: string; count: number }> {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "ru"));
}
