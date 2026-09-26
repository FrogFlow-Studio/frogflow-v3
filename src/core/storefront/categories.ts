type Cat = { id: string; parent_id: string | null; is_visible: boolean };

/**
 * Категории, которые видит покупатель: скрыта сама или кто-то из предков —
 * не видна (скрыл продавец раздел — скрыто всё внутри). Цикл в parent_id
 * считается скрытым, а не зависает.
 */
export function visibleCategoryIds(cats: readonly Cat[]): Set<string> {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out = new Set<string>();
  for (const c of cats) {
    let cur: Cat | undefined = c;
    const seen = new Set<string>();
    let ok = true;
    while (cur) {
      if (!cur.is_visible || seen.has(cur.id)) {
        ok = false;
        break;
      }
      seen.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    if (ok) out.add(c.id);
  }
  return out;
}

/** Категория и все её видимые подкатегории на любой глубине. */
export function categorySubtree(
  cats: readonly Cat[],
  rootId: string,
  visible: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  if (!visible.has(rootId)) return out;
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of cats) if (c.parent_id === id && visible.has(c.id)) stack.push(c.id);
  }
  return out;
}

/**
 * Товар на витрине: без категорий — виден; с категориями — если хоть одна
 * видна. Ссылка на удалённую категорию видимости не даёт и не отнимает: если
 * других нет, товар считается «без категории».
 */
export function productOnStorefront(
  categoryIds: readonly string[],
  known: ReadonlySet<string>,
  visible: ReadonlySet<string>,
): boolean {
  const live = categoryIds.filter((id) => known.has(id));
  return live.length === 0 || live.some((id) => visible.has(id));
}
