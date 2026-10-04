/**
 * Умный поиск на витрине (shop16-o-smart.spec.ts): два магазина-близнеца, у одного
 * переключатель smart_search_enabled включён, у другого нет.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, nulls } from "./util.ts";

export function seedShop16OSmart(db: StubDb, now: string) {
  const shops = [
    { id: F.SMART16_SHOP_ID, slug: F.SMART16_SHOP_SLUG, on: true, n: 1 },
    { id: F.SMART16_OFF_SHOP_ID, slug: F.SMART16_OFF_SHOP_SLUG, on: false, n: 2 },
  ];
  for (const sh of shops) {
    const own = <T extends object>(r: T) => ({ bot_id: sh.id, ...r });
    add(db, "bots", [
      {
        id: sh.id,
        bot_name: F.SMART16_SHOP_NAME,
        status: "active",
        vertical: "digital",
        modules: { shop: true, web_storefront: true, smart_search: true },
        settings: {
          served_by: "v2",
          default_locale: "ru",
          slug: sh.slug,
          telegram: { username: `e2e_smart16_bot${sh.n}`, webhook_ok: true },
        },
        paused_message: null,
        owner_telegram_id: 500000500 + sh.n,
        owner_name: "Продавец О7",
        app_url: null,
        archived_at: null,
        bot_token: encrypt(`70000050${sh.n}:E2E-smart16-token`, F.SECRETS_KEY),
        subscription_plan: "business",
        subscription_expires_at: null,
        created_at: now,
      },
    ]);
    add(db, "app_settings", [
      own({ key: "shop_name", value: F.SMART16_SHOP_NAME, updated_at: now }),
      own({ key: "smart_search_enabled", value: sh.on ? "true" : "false", updated_at: now }),
    ]);
    const product = (n: number, name: string, keywords: string | null, sort: number) =>
      own({
        id: `e2e00000-0000-4000-8000-00001600e${sh.n}${n}0`,
        name,
        description: "Свежая выпечка.",
        keywords,
        price: 5000,
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
        sort_order: sort,
        created_at: now,
      });
    add(db, "products", [
      product(1, F.SMART16_CAKE_NAME, "e2e-smart", 0),
      product(2, F.SMART16_PIE_NAME, null, 1),
    ]);
  }
}
