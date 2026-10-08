/**
 * Листание без потерь (seed/shop23-list.ts, shop23-list.spec.ts): магазин «Листание Т23»
 * с 50 материалами — больше одной страницы каталога (48), чтобы было что догружать.
 */
export const LIST23_SHOP_ID = "e2e23040-0000-4000-8000-000000000001";
export const LIST23_SHOP_NAME = "Листание Т23";
export const LIST23_SHOP_SLUG = "e2e-list23";
export const LIST23_COUNT = 50;
/** Материал номер n (1…50) — по порядку продавца. */
export const list23Id = (n: number) =>
  `e2e23040-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
export const list23Name = (n: number) => `Материал Т23 №${String(n).padStart(2, "0")}`;
