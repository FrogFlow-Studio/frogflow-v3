/**
 * Витрина с промокодами и бесплатной доставкой от 10 000 (shop15-free-promo.spec.ts):
 * магазин «Кондитерская П15» с одним физическим товаром 10 500 и районом за 500.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const free = <T extends object>(r: T) => ({ bot_id: F.FREE15_SHOP_ID, ...r });

export function seedShop15FreePromo(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.FREE15_SHOP_ID,
      bot_name: F.FREE15_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true, coupons: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.FREE15_SHOP_SLUG,
        telegram: { username: "e2e_free15_bot", webhook_ok: true },
        admin: { username: "e2e_free15_seller", password_hash: hash("e2e-free15-pass-123") },
      },
      paused_message: null,
      owner_telegram_id: 500000115,
      owner_name: "Продавец П15",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000115:E2E-free15-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    free({ key: "shop_name", value: F.FREE15_SHOP_NAME, updated_at: now }),
    free({ key: "storefront_checkout", value: '{"enabled":true}', updated_at: now }),
    free({ key: "delivery_free_from", value: String(F.FREE15_THRESHOLD), updated_at: now }),
  ]);
  add(db, "payment_methods", [
    free({
      id: "e2e00000-0000-4000-8000-00000000fe04",
      country_code: "KZ",
      country_name: "Казахстан",
      currency: "KZT",
      instructions: "Переведите сумму на Kaspi Gold 4400 0000 0000 0000 и пришлите чек.",
      qr_code_path: null,
      is_active: true,
      sort_order: 0,
      created_at: now,
    }),
  ]);
  add(db, "delivery_zones", [
    free({
      id: F.FREE15_ZONE_ID,
      name: F.FREE15_ZONE_NAME,
      price: 500,
      sort_order: 0,
      is_active: true,
      created_at: now,
    }),
  ]);
  const product = (id: string, name: string, price: number, sort: number) =>
    free({
      id,
      name,
      description: "Свежая выпечка.",
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
      sort_order: sort,
      created_at: now,
    });
  add(db, "products", [product(F.FREE15_CAKE_ID, "Торт П15", F.FREE15_CAKE_PRICE, 0)]);
}
