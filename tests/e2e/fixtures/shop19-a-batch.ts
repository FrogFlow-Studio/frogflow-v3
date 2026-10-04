/**
 * Сборка и печать пачкой (seed/shop19-a-batch.ts, shop19-a-batch.spec.ts): магазин
 * «Сборка А16» — три физических заказа к сборке на сегодня и один на завтра.
 * Часовой пояс магазина задан явно (UTC), день получения — сегодняшний.
 */
export const BATCH_SHOP_ID = "e2e19160-0000-4000-8000-000000000001";
export const BATCH_SHOP_NAME = "Сборка А16";
export const BATCH_SHOP_SLUG = "e2e-batch16";
export const BATCH_SELLER_LOGIN = "e2e_batch16_seller";
export const BATCH_SELLER_PASSWORD = "e2e-batch16-pass-123";
/** [id, имя, доставка, день: 0 — сегодня, 1 — завтра] */
export const BATCH_ORDERS = [
  [98951, "Сборка Анна", true, 0],
  [98952, "Сборка Борис", true, 0],
  [98953, "Сборка Вера", false, 0],
  [98954, "Сборка Глеб", true, 1],
] as const;
