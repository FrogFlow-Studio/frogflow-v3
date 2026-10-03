import { MAX_INACTIVE_DAYS } from "./segments";

/**
 * Готовый сегмент из адреса страницы рассылок: `?segment=inactive&days=60`
 * (кнопка «Рассылка им» в аналитике). Только чтение параметра: что выбрано
 * в форме, продавец видит и может поменять; отправка идёт обычным путём.
 */
export type SegmentParam = { kind: "inactive"; days: number };

export function parseSegmentParam(search: {
  segment?: unknown;
  days?: unknown;
}): SegmentParam | null {
  if (search.segment !== "inactive") return null;
  const days = Number(search.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_INACTIVE_DAYS) return null;
  return { kind: "inactive", days };
}

export function inactiveSegmentSearch(days: number): { segment: "inactive"; days: number } {
  return { segment: "inactive", days };
}
