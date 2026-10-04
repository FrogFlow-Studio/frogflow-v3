/**
 * Обход новых страниц админки (seed/shop20-r-walk.ts, shop20-r-walk.spec.ts): магазин «Обход Р20»
 * — владелец, бухгалтер и три сегодняшних заказа к сборке. Основной магазин сида не меняется.
 */
export const R20_SHOP_ID = "e2e20100-0000-4000-8000-000000000001";
export const R20_SHOP_NAME = "Обход Р20";
export const R20_SHOP_SLUG = "e2e-r20";
export const R20_SELLER_LOGIN = "e2e_r20_seller";
export const R20_SELLER_PASSWORD = "e2e-r20-pass-12345";
export const R20_ACC_LOGIN = "e2e_r20_acc";
export const R20_ACC_PASSWORD = "e2e-r20-acc-12345";
/** [id, имя] — все на сегодня. */
export const R20_ORDERS = [
  [99101, "Обход Анна"],
  [99102, "Обход Борис"],
  [99103, "Обход Вера"],
] as const;
