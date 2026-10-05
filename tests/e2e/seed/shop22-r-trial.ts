/** Пробный заказ (shop22-r-trial.spec.ts): магазин «Пробный Р22» без бота Telegram. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, hash, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.TRIAL22_SHOP_ID, ...r });

export function seedShop22RTrial(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.TRIAL22_SHOP_ID,
      bot_name: F.TRIAL22_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.TRIAL22_SHOP_SLUG,
        admin: {
          username: F.TRIAL22_SELLER_LOGIN,
          password_hash: hash(F.TRIAL22_SELLER_PASSWORD),
        },
      },
      paused_message: null,
      owner_telegram_id: null,
      owner_name: "Продавец Пробный Р22",
      app_url: null,
      archived_at: null,
      bot_token: null,
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.TRIAL22_SHOP_NAME, updated_at: now })]);
  add(db, "payment_methods", [
    own({
      id: "e2e22054-0000-4000-8000-0000000000a1",
      country_code: "KZ",
      country_name: "Казахстан",
      currency: "KZT",
      instructions: "Kaspi Gold 4400 0000 0000 0001",
      qr_code_path: null,
      is_active: true,
      sort_order: 0,
      created_at: now,
    }),
  ]);
  add(db, "products", [
    own({
      id: "e2e22054-0000-4000-8000-000000000011",
      name: F.TRIAL22_ITEM_NAME,
      description: "",
      keywords: "",
      price: 3200,
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
      sort_order: 1,
      created_at: now,
    }),
  ]);
}
