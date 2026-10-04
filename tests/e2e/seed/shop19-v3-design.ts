/** Оформление витрины (shop19-v3-design.spec.ts): тёплая тема и блок «Новинки». */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, nulls } from "./util.ts";

export function seedShop19V3Design(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.DESIGN_SHOP_ID,
      bot_name: F.DESIGN_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.DESIGN_SHOP_SLUG,
        telegram: { username: "e2e_design_bot", webhook_ok: true },
        storefront_design: { theme: "warm", cover: false, blocks: ["new"] },
        // В4: страница «О магазине» (shop19-v4-about.spec.ts).
        storefront_about: {
          description: "Соевые свечи ручной работы.",
          phone: "+7 700 111 22 33",
          address: "Алматы, ул. Абая, 1",
          hours: "Пн–Сб 10:00–19:00",
          delivery: "Курьером по Алматы за 1 день.",
          payment: "Kaspi или наличными.",
        },
      },
      paused_message: null,
      owner_telegram_id: 500000193,
      owner_name: "Продавец В3",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000193:E2E-design-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    { bot_id: F.DESIGN_SHOP_ID, key: "shop_name", value: F.DESIGN_SHOP_NAME, updated_at: now },
  ]);
  add(db, "products", [
    {
      bot_id: F.DESIGN_SHOP_ID,
      id: F.DESIGN_PRODUCT_ID,
      name: F.DESIGN_PRODUCT_NAME,
      description: "Соевая свеча.",
      price: 3000,
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
      sort_order: 0,
      created_at: now,
    },
  ]);
}
