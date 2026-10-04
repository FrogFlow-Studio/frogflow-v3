/**
 * Заказы на телефоне (seed/shop19-a-orders.ts, shop19-a-orders.spec.ts): отдельный магазин
 * «Заказы А19» с тремя заказами в разных статусах. Основной магазин сида не меняется.
 */
export const ORD19_SHOP_ID = "e2e19030-0000-4000-8000-000000000001";
export const ORD19_SHOP_NAME = "Заказы А19";
export const ORD19_SHOP_SLUG = "e2e-ord19";
export const ORD19_SELLER_LOGIN = "e2e_ord19_seller";
export const ORD19_SELLER_PASSWORD = "e2e-ord19-pass-123";
/** [id, статус, имя, телефон, товар] */
export const ORD19_ORDERS = [
  [98901, "awaiting_confirmation", "Айгерим Ж", "+77011112233", "Букет А19"],
  [98902, "accepted", "Борис К", "+77014445566", "Торт А19"],
  [98903, "delivered", "Виктор Л", "+77017778899", "Свеча А19"],
] as const;

/** Товары для массовых действий: больше одной страницы списка (100). */
export const ORD19_BULK_COUNT = 120;
