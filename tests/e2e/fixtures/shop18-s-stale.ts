/**
 * Залежавшийся товар (seed/shop18-s-stale.ts, shop18-s-stale.spec.ts): отдельный магазин
 * «Склад С18» с модулями «Склад» и «Акции». Три товара без продаж за 60 дней, один продан
 * на днях. Основной магазин сида не меняется.
 */
export const STALE18_SHOP_ID = "e2e18510-0000-4000-8000-000000000001";
export const STALE18_SHOP_NAME = "Склад С18";
export const STALE18_SHOP_SLUG = "e2e-stale18";
export const STALE18_SELLER_LOGIN = "e2e_stale18_seller";
export const STALE18_SELLER_PASSWORD = "e2e-stale18-pass-123";
/** Залежались: порядок по «заморожено» — Ваза (10 × 500), Подсвечник (4 × 600), Шкатулка (без себестоимости). */
export const STALE18_PRODUCT_IDS = [
  "e2e18510-0000-4000-8000-000000000011",
  "e2e18510-0000-4000-8000-000000000012",
  "e2e18510-0000-4000-8000-000000000013",
];
export const STALE18_PRODUCT_NAMES = ["Ваза С18", "Подсвечник С18", "Шкатулка С18"];
/** Продан на днях — в отчёт не попадает. */
export const STALE18_SOLD_PRODUCT_ID = "e2e18510-0000-4000-8000-000000000014";
export const STALE18_SOLD_PRODUCT_NAME = "Свеча С18";
export const STALE18_ORDER_ID = 98501;
