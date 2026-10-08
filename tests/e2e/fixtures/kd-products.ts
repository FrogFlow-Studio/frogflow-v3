/**
 * Список товаров админки (seed/kd-products.ts, kd-products.spec.ts): магазин
 * «Дидактика Т» — порядок «сначала новые», фильтр «есть / нет на KZ», поиск
 * по ключевым словам.
 */
export const KDP_SHOP_ID = "e2e2a100-0000-4000-8000-000000000001";
export const KDP_SHOP_NAME = "Дидактика Т";
export const KDP_SHOP_SLUG = "e2e-kdp";
export const KDP_SELLER_LOGIN = "e2e_kdp_seller";
export const KDP_SELLER_PASSWORD = "e2e-kdp-pass-123";
/** [id, название, добавлен, казахский файл: таблица / старое поле v1 / нет, физический] */
export const KDP_PRODUCTS = [
  ["e2e2a100-0000-4000-8000-000000000101", "Азбука КД", "2026-09-01T10:00:00Z", "table", false],
  ["e2e2a100-0000-4000-8000-000000000102", "Буквы КД", "2026-09-05T10:00:00Z", "legacy", false],
  ["e2e2a100-0000-4000-8000-000000000103", "Слоги КД", "2026-09-20T10:00:00Z", "none", false],
  ["e2e2a100-0000-4000-8000-000000000104", "Пенал КД", "2026-10-01T10:00:00Z", "none", true],
] as const;
/** Код материала — только в ключевых словах «Слоги КД». */
export const KDP_CODE = "KD-0457";
