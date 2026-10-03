/**
 * Избранное витрины: список id товаров в браузере покупателя (localStorage,
 * по магазину), без входа и без записи в базу. Исчезнувшие товары тихо
 * убираются при открытии страницы «Избранное».
 */
export const FAVORITES_MAX = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Сохранённая строка → список id; битый JSON, не uuid и повторы отбрасываются. */
export function parseFavorites(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const v of data) {
    if (typeof v === "string" && UUID.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= FAVORITES_MAX) break;
  }
  return out;
}

/** Добавить (новый — первым) или убрать, если уже в избранном. */
export function toggleFavorite(list: readonly string[], id: string): string[] {
  return list.includes(id)
    ? list.filter((x) => x !== id)
    : [id, ...list.filter((x) => x !== id)].slice(0, FAVORITES_MAX);
}

/** Оставить только те id, что магазин ещё отдаёт; порядок избранного сохраняется. */
export function pruneFavorites(list: readonly string[], existing: Iterable<string>): string[] {
  const alive = new Set(existing);
  return list.filter((id) => alive.has(id));
}
