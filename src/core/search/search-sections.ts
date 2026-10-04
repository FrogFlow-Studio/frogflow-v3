/** Разделы админки по названию (клиентская часть быстрого поиска, без серверных импортов). */
export const SECTIONS_SHOWN = 5;

export function searchSections<T extends { label: string }>(items: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return items.filter((i) => i.label.toLowerCase().includes(needle)).slice(0, SECTIONS_SHOWN);
}
