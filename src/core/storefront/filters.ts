/**
 * Фильтры главной витрины: «в наличии» и цена от–до (`?stock=1&min=&max=`).
 * Цена — наименьшая цена варианта, а без вариантов базовая цена товара
 * (products.price) в валюте магазина; проверяется после чтения страницы
 * (filterPrice в catalog.ts), как «в наличии».
 */
export const PRICE_BOUND_MAX = 1_000_000_000;

/** Граница цены из адреса: неотрицательное число; пусто и мусор — не задана. */
export function parsePriceBound(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= PRICE_BOUND_MAX ? n : null;
}

/** «От» больше «до» — поменять местами: покупатель хотел диапазон, а не пустой список. */
export function priceRange(min: unknown, max: unknown): { min: number | null; max: number | null } {
  const lo = parsePriceBound(min);
  const hi = parsePriceBound(max);
  return lo !== null && hi !== null && lo > hi ? { min: hi, max: lo } : { min: lo, max: hi };
}
