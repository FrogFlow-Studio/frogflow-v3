/**
 * Категории товара. Админка пишет только `category_ids` (jsonb-массив), старая
 * колонка `category_id` осталась от v1 и после правки категорий устаревает.
 * Поэтому `category_id` — запасной вариант, только когда массива нет или он пуст.
 */
export function productCategoryIds(p: {
  category_id?: string | null;
  category_ids?: unknown;
}): string[] {
  const list = Array.isArray(p.category_ids)
    ? (p.category_ids as unknown[]).filter((c): c is string => typeof c === "string" && c !== "")
    : [];
  if (list.length > 0) return list;
  return p.category_id ? [p.category_id] : [];
}
