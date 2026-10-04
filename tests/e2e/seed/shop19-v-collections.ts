/**
 * Витрина с подборками (shop19-v-collections.spec.ts): «Лавка подборок» с модулем
 * «Склад», подборка «Подарки» из товара в продаже, закончившегося и снятого,
 * и подборка, где все товары удалены.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.COL19_SHOP_ID, ...r });

export function seedShop19VCollections(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.COL19_SHOP_ID,
      bot_name: F.COL19_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true, stock: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.COL19_SHOP_SLUG,
        telegram: { username: "e2e_col19_bot", webhook_ok: true },
        admin: { username: "e2e_col19_seller", password_hash: hash("e2e-col19-pass-123") },
        collections: [
          {
            id: F.COL19_CODE,
            name: "Подарки",
            product_ids: [F.COL19_SOLD_ID, F.COL19_OFF_ID, F.COL19_LIVE_ID],
            created_at: now,
          },
          {
            id: F.COL19_EMPTY_CODE,
            name: "Пустая подборка",
            product_ids: ["e2e00000-0000-4000-8000-0000000019ff"],
            created_at: now,
          },
        ],
      },
      paused_message: null,
      owner_telegram_id: 500000119,
      owner_name: "Продавец подборок",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000119:E2E-col19-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.COL19_SHOP_NAME, updated_at: now }),
    own({ key: "storefront_checkout", value: '{"enabled":true}', updated_at: now }),
  ]);
  const product = (id: string, name: string, sort: number, extra: Record<string, unknown> = {}) =>
    own({
      id,
      name,
      description: "Подарок.",
      price: 5000,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      category_ids: [],
      fulfillment_kind: "physical",
      stock_quantity: 5,
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
      sort_order: sort,
      created_at: now,
      ...extra,
    });
  add(db, "products", [
    product(F.COL19_LIVE_ID, F.COL19_LIVE_NAME, 0),
    product(F.COL19_SOLD_ID, F.COL19_SOLD_NAME, 1, { stock_quantity: 0 }),
    product(F.COL19_OFF_ID, F.COL19_OFF_NAME, 2, { is_active: false }),
  ]);
}
