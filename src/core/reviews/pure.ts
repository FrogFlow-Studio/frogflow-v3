/** Отзывы и рейтинг — чистые функции без базы. */

export function isValidRating(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

export function starsForRating(rating: number): string {
  const c = Math.min(5, Math.max(1, Math.round(rating)));
  return "⭐".repeat(c) + "☆".repeat(5 - c);
}

/** «⭐ 4.5 (12)» или null, если оценок нет. */
export function formatRatingSummary(avg: number | null | undefined, count: number): string | null {
  if (!count || avg === null || avg === undefined) return null;
  return `⭐ ${Number(avg).toFixed(1)} (${count})`;
}
