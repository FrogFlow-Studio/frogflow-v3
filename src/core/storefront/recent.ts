/**
 * «Недавно смотрели» на витрине: id открытых товаров в браузере покупателя
 * (localStorage, по магазину), последний открытый — первым. Сервер список
 * не хранит; исчезнувшие и скрытые товары просто не приходят в ответе.
 */
export const RECENT_MAX = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Сохранённая строка → список id; битый JSON, не uuid и повторы отбрасываются. */
export function parseRecent(raw: string | null | undefined): string[] {
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
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

/** Открытый товар встаёт первым; если он уже был в списке, переезжает наверх, а не дублируется. */
export function pushRecent(list: readonly string[], id: string): string[] {
  if (!UUID.test(id)) return [...list];
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}

/** Порядок «недавно смотрели» сохраняется, пропавшие товары убираются. */
export function orderRecent<T extends { id: string }>(
  ids: readonly string[],
  products: readonly T[],
  exclude: ReadonlySet<string> = new Set(),
): T[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    return p && !exclude.has(id) ? [p] : [];
  });
}
