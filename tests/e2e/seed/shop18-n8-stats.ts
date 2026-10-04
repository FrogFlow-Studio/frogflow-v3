/**
 * Итоги наборов и подарков (shop18-n8-stats.spec.ts): магазин «Наборы Н18». В основной
 * магазин ничего не добавляем.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.N8_SHOP_ID, ...r });
const DAY = 86_400_000;

export function seedShop18N8Stats(db: StubDb, now: string) {
  const recent = new Date(Date.parse(now) - 3 * DAY).toISOString();
  add(db, "bots", [
    {
      id: F.N8_SHOP_ID,
      bot_name: F.N8_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true, bundles: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.N8_SHOP_SLUG,
        telegram: { username: "e2e_bundles18_bot", webhook_ok: true },
        admin: { username: F.N8_SELLER_LOGIN, password_hash: hash(F.N8_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000019,
      owner_name: "Продавец Н18",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000019:E2E-bundles18-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.N8_SHOP_NAME, updated_at: now }),
    // Состав: по одному шампуню (1 000) и бальзаму (800) — по отдельности 1 800 против 1 500.
    own({
      key: `bundle:${F.N8_BUNDLE_ID}`,
      value: JSON.stringify({
        items: [
          { p: F.N8_PART_IDS[0], q: 1 },
          { p: F.N8_PART_IDS[1], q: 1 },
        ],
      }),
      updated_at: now,
    }),
  ]);
  const prods: Array<[string, string, number]> = [
    [F.N8_BUNDLE_ID, F.N8_BUNDLE_NAME, 1500],
    [F.N8_PART_IDS[0]!, "Шампунь Н18", 1000],
    [F.N8_PART_IDS[1]!, "Бальзам Н18", 800],
  ];
  prods.forEach(([id, name, price], i) =>
    add(db, "products", [
      own({
        id,
        name,
        description: "Для e2e.",
        price,
        currency: "KZT",
        country_prices: {},
        is_active: true,
        category_ids: [],
        fulfillment_kind: "physical",
        stock_quantity: null,
        lead_time_days: null,
        ...nulls([
          "file_path",
          "file_name",
          "file_url",
          "file_path_kz",
          "file_name_kz",
          "file_url_kz",
          "rating_avg",
        ]),
        rating_count: 0,
        sort_order: i,
        created_at: recent,
      }),
    ]),
  );
  const order = (id: number, no: number, status: string, total: number) =>
    own({
      id,
      order_no: no,
      display_no: no,
      status,
      platform: "telegram",
      telegram_id: 600000019,
      user_key: "tg_600000019",
      display_name: "Анна",
      username: null,
      total,
      paid_amount: status === "delivered" ? total : 0,
      currency: "KZT",
      fulfillment_kind: "physical",
      created_at: recent,
      updated_at: recent,
    });
  add(db, "orders", [
    order(F.N8_ORDER_IDS[0]!, 1, "delivered", 3500),
    order(F.N8_ORDER_IDS[1]!, 2, "pending", 13500),
    order(F.N8_ORDER_IDS[2]!, 3, "delivered", 1000),
  ]);
  const item = (
    n: number,
    orderId: number,
    productId: string | null,
    name: string,
    qty: number,
    price: number,
  ) =>
    own({
      id: `e2e18800-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
      order_id: orderId,
      product_id: productId,
      product_variant_id: null,
      name_snapshot: name,
      quantity: qty,
      price_snapshot: price,
    });
  add(db, "order_items", [
    item(1, F.N8_ORDER_IDS[0]!, F.N8_BUNDLE_ID, F.N8_BUNDLE_NAME, 2, 1500),
    // Упаковка — строка заказа без товара, с меткой в названии (core/orders/gift-wrap).
    item(2, F.N8_ORDER_IDS[0]!, null, "🎁⁣Подарочная упаковка", 1, 500),
    item(3, F.N8_ORDER_IDS[1]!, F.N8_BUNDLE_ID, F.N8_BUNDLE_NAME, 9, 1500),
    item(4, F.N8_ORDER_IDS[2]!, F.N8_PART_IDS[0]!, "Шампунь Н18", 1, 1000),
  ]);
  add(db, "zernio_logs", [
    ...[F.N8_ORDER_IDS[0]!, F.N8_ORDER_IDS[1]!].map((id) => ({
      bot_id: F.N8_SHOP_ID,
      event_id: `order:${id}:gift:once`,
      event_type: "order.gift",
      status: "event",
      payload: { recipient: "Мама", message: "С праздником!", truncated: false },
      error_message: null,
      created_at: recent,
    })),
  ]);
}
