/**
 * Залежавшийся товар (shop18-s-stale.spec.ts): магазин «Склад С18». В основной магазин
 * ничего не добавляем.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.STALE18_SHOP_ID, ...r });
const DAY = 86_400_000;

export function seedShop18Stale(db: StubDb, now: string) {
  const old = new Date(Date.parse(now) - 200 * DAY).toISOString();
  const recent = new Date(Date.parse(now) - 3 * DAY).toISOString();
  add(db, "bots", [
    {
      id: F.STALE18_SHOP_ID,
      bot_name: F.STALE18_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true, stock: true, warehouse: true, limited_offers: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.STALE18_SHOP_SLUG,
        telegram: { username: "e2e_stale18_bot", webhook_ok: true },
        admin: { username: F.STALE18_SELLER_LOGIN, password_hash: hash(F.STALE18_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000018,
      owner_name: "Продавец С18",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000018:E2E-stale18-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.STALE18_SHOP_NAME, updated_at: now }),
    own({
      key: `cost:${F.STALE18_PRODUCT_IDS[0]}`,
      value: '{"p":500,"v":{},"cur":"KZT"}',
      updated_at: now,
    }),
    own({
      key: `cost:${F.STALE18_PRODUCT_IDS[1]}`,
      value: '{"p":600,"v":{},"cur":"KZT"}',
      updated_at: now,
    }),
  ]);
  const stocks = [10, 4, 7, 5];
  const ids = [...F.STALE18_PRODUCT_IDS, F.STALE18_SOLD_PRODUCT_ID];
  const names = [...F.STALE18_PRODUCT_NAMES, F.STALE18_SOLD_PRODUCT_NAME];
  ids.forEach((id, i) =>
    add(db, "products", [
      own({
        id,
        name: names[i],
        description: "Ручная работа.",
        price: 3000,
        currency: "KZT",
        country_prices: {},
        is_active: true,
        category_ids: [],
        fulfillment_kind: "physical",
        stock_quantity: stocks[i],
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
        created_at: old,
      }),
    ]),
  );
  add(db, "orders", [
    own({
      id: F.STALE18_ORDER_ID,
      order_no: 1,
      display_no: 1,
      status: "delivered",
      platform: "telegram",
      telegram_id: 600000018,
      user_key: "tg_600000018",
      display_name: "Анна",
      username: null,
      total: 3000,
      paid_amount: 3000,
      currency: "KZT",
      fulfillment_kind: "physical",
      created_at: recent,
      updated_at: recent,
    }),
  ]);
  add(db, "order_items", [
    own({
      id: "e2e18510-0000-4000-8000-000000000021",
      order_id: F.STALE18_ORDER_ID,
      product_id: F.STALE18_SOLD_PRODUCT_ID,
      product_variant_id: null,
      name_snapshot: F.STALE18_SOLD_PRODUCT_NAME,
      quantity: 1,
      price_snapshot: 3000,
    }),
  ]);
}
