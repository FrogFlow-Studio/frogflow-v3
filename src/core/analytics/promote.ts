/**
 * «Что продвигать» (У4): две подсказки из данных, без прогнозов.
 *  — «Хорошо оценивают, берут редко»: одобренные отзывы со средней оценкой от
 *    4,5 (не меньше трёх отзывов), а за окно куплено не больше двух штук;
 *  — «Скоро закончится при нынешнем спросе»: остаток ведётся, товар покупали
 *    (от трёх штук за окно), и остатка хватит на две недели или меньше при
 *    том же темпе продаж. Это арифметика по продажам окна, а не прогноз:
 *    текст в интерфейсе так и говорит.
 * Модуль без базы: его читают сервер и тесты.
 */
export const PROMOTE = {
  /** Окно продаж, дней. */
  windowDays: 30,
  minRating: 4.5,
  minReviews: 3,
  /** «Берут редко»: не больше стольких штук за окно. */
  fewSold: 2,
  /** «Есть спрос»: не меньше стольких штук за окно. */
  demandSold: 3,
  /** Остатка хватит не больше, чем на столько дней. */
  coverDays: 14,
  /** Сколько подсказок каждого вида показывать. */
  shown: 5,
} as const;

export type PromoteItem = {
  id: string;
  name: string;
  /** Остаток; null — не ведётся (без ограничения). */
  stock: number | null;
  rating: { avg: number; count: number } | null;
  /** Штук продано за окно (оплаченные заказы). */
  sold: number;
};

export type QualityHint = { id: string; name: string; avg: number; count: number; sold: number };
export type StockHint = { id: string; name: string; stock: number; sold: number; daysLeft: number };
export type PromoteHints = {
  quality: QualityHint[];
  stock: StockHint[];
  /** Сколько подсказок нашлось всего (показывается не больше PROMOTE.shown). */
  total: { quality: number; stock: number };
};

export function promoteHints(items: readonly PromoteItem[]): PromoteHints {
  const quality: QualityHint[] = [];
  const stock: StockHint[] = [];
  for (const p of items) {
    if (
      p.rating &&
      p.rating.count >= PROMOTE.minReviews &&
      p.rating.avg >= PROMOTE.minRating &&
      p.sold <= PROMOTE.fewSold
    )
      quality.push({
        id: p.id,
        name: p.name,
        avg: p.rating.avg,
        count: p.rating.count,
        sold: p.sold,
      });
    if (p.stock !== null && p.sold >= PROMOTE.demandSold) {
      const daysLeft = Math.floor((Math.max(0, p.stock) / p.sold) * PROMOTE.windowDays);
      if (daysLeft <= PROMOTE.coverDays)
        stock.push({ id: p.id, name: p.name, stock: Math.max(0, p.stock), sold: p.sold, daysLeft });
    }
  }
  quality.sort((a, b) => b.avg - a.avg || b.count - a.count || a.id.localeCompare(b.id));
  stock.sort((a, b) => a.daysLeft - b.daysLeft || b.sold - a.sold || a.id.localeCompare(b.id));
  return {
    quality: quality.slice(0, PROMOTE.shown),
    stock: stock.slice(0, PROMOTE.shown),
    total: { quality: quality.length, stock: stock.length },
  };
}
