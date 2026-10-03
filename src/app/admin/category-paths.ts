/**
 * Путь раздела от корня: «Сад › Математика» — в карточке товара одинаковые
 * имена подразделов различимы (Educational Bot, 03.10). Цикл в parent_id не
 * зацикливает: каждый раздел в пути один раз.
 */
export type CategoryOption = { id: string; name: string; parent_id: string | null };

export function categoryPaths(categories: CategoryOption[]): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out = new Map<string, string>();
  for (const c of categories) {
    const names: string[] = [];
    const seen = new Set<string>();
    let cur: CategoryOption | undefined = c;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    out.set(c.id, names.join(" › "));
  }
  return out;
}
