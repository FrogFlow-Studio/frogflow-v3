/**
 * Итоги наборов и подарков (seed/shop18-n8-stats.ts, shop18-n8-stats.spec.ts): отдельный
 * магазин «Наборы Н18» с модулем «Наборы». Основной магазин сида не меняется.
 * Заказ 1 — выданный: 2 набора по 1 500, подарок, упаковка 500. Заказ 2 — неоплаченный
 * (9 наборов, подарок): в итоги не входит. Заказ 3 — выданный, без наборов и подарка.
 */
export const N8_SHOP_ID = "e2e18800-0000-4000-8000-000000000001";
export const N8_SHOP_NAME = "Наборы Н18";
export const N8_SHOP_SLUG = "e2e-bundles18";
export const N8_SELLER_LOGIN = "e2e_bundles18_seller";
export const N8_SELLER_PASSWORD = "e2e-bundles18-pass-123";
export const N8_BUNDLE_ID = "e2e18800-0000-4000-8000-000000000011";
export const N8_BUNDLE_NAME = "Набор «Уход» Н18";
export const N8_PART_IDS = [
  "e2e18800-0000-4000-8000-000000000012",
  "e2e18800-0000-4000-8000-000000000013",
];
export const N8_ORDER_IDS = [98801, 98802, 98803];
