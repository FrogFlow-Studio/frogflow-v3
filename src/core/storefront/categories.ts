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

type Node = { id: string; parent_id: string | null };

/**
 * Чипы категорий витрины — дерево, как папки в боте v1: без выбора — только
 * корневые; у открытой категории второй ряд — её подкатегории, у листа — его
 * соседи (подкатегории родителя). path — цепочка от корня до выбранной, для
 * подсветки. Категории приходят уже видимыми и отсортированными (storeInfo);
 * неизвестный id — как «без выбора». Цикл в parent_id не зависает.
 */
export function categoryChips<T extends Node>(
  all: readonly T[],
  currentId?: string | null,
): { roots: T[]; current: T | null; path: string[]; subParent: string | null; subs: T[] } {
  const byId = new Map(all.map((c) => [c.id, c]));
  const current = (currentId && byId.get(currentId)) || null;
  const path: string[] = [];
  for (
    let c: T | undefined = current ?? undefined;
    c && !path.includes(c.id);
    c = c.parent_id ? byId.get(c.parent_id) : undefined
  )
    path.unshift(c.id);
  const children = (id: string) => all.filter((c) => c.parent_id === id);
  const subParent = current
    ? children(current.id).length
      ? current.id
      : current.parent_id && byId.has(current.parent_id)
        ? current.parent_id
        : null
    : null;
  return {
    roots: all.filter((c) => !c.parent_id || !byId.has(c.parent_id)),
    current,
    path,
    subParent,
    subs: subParent ? children(subParent) : [],
  };
}
