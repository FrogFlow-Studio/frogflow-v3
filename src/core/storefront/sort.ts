/**
 * Сортировка каталога витрины, как в Mini App v1 (tests/mini-app-catalog.test.ts,
 * sortMiniAppProductIds): «catalog» — порядок продавца (sort_order, имя);
 * «popular» — по числу отзывов, при равенстве по средней оценке; «new» — по
 * дате создания; «price» — по базовой цене товара, от дешёвых. Сортирует уже
 * отфильтрованный список (поиск, категория) и не меняет исходный.
 */
export const CATALOG_SORTS = ["catalog", "popular", "new", "price"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export function parseCatalogSort(v: unknown): CatalogSort {
  return CATALOG_SORTS.includes(v as CatalogSort) ? (v as CatalogSort) : "catalog";
}

type Sortable = {
  rating_count?: number | null;
  rating_avg?: number | string | null;
  created_at?: string | null;
  price?: number | string | null;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function sortCatalog<T extends Sortable>(rows: readonly T[], sort: CatalogSort): T[] {
  const out = rows.slice();
  if (sort === "popular")
    out.sort(
      (a, b) => num(b.rating_count) - num(a.rating_count) || num(b.rating_avg) - num(a.rating_avg),
    );
  else if (sort === "new")
    out.sort((a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "") || 0);
  else if (sort === "price") out.sort((a, b) => num(a.price) - num(b.price));
  return out;
}
