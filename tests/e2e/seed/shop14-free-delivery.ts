/**
 * Витрина с бесплатной доставкой от суммы (shop14-free-delivery.spec.ts): магазин
 * «Кондитерская Д14» с двумя физическими товарами (2000 и 1500), районом доставки
 * за 500 и порогом 3000. Основной магазин сида не меняется.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const free = <T extends object>(r: T) => ({ bot_id: F.FREE14_SHOP_ID, ...r });

export function seedShop14FreeDelivery(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.FREE14_SHOP_ID,
      bot_name: F.FREE14_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.FREE14_SHOP_SLUG,
        telegram: { username: "e2e_free14_bot", webhook_ok: true },
        admin: { username: F.FREE14_SELLER_LOGIN, password_hash: hash(F.FREE14_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000114,
      owner_name: "Продавец Д14",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000114:E2E-free14-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    free({ key: "shop_name", value: F.FREE14_SHOP_NAME, updated_at: now }),
    free({ key: "storefront_checkout", value: '{"enabled":true}', updated_at: now }),
    free({ key: "delivery_free_from", value: String(F.FREE14_THRESHOLD), updated_at: now }),
  ]);
  add(db, "payment_methods", [
    free({
      id: "e2e00000-0000-4000-8000-00000000fd04",
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
      id: F.FREE14_ZONE_ID,
      name: F.FREE14_ZONE_NAME,
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
  add(db, "products", [
    product(F.FREE14_CAKE_ID, "Торт Д14", F.FREE14_CAKE_PRICE, 0),
    product(F.FREE14_SWEET_ID, "Пирожное Д14", F.FREE14_SWEET_PRICE, 1),
  ]);
}
