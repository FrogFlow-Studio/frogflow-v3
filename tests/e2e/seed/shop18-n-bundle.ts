/**
 * Набор товаров на витрине (shop18-n-bundle.spec.ts): отдельный магазин «Косметика Н18»
 * с модулем bundles. Набор «шампунь × 2 + бальзам» стоит 3000 ₸ при 2000 ₸ + 1500 ₸
 * порознь (выгода 2500 ₸), рядом — обычный товар. Состав — запись app_settings
 * `bundle:<id набора>`, как её пишет карточка товара в админке. Основной магазин
 * сида не меняется: модуль bundles добавляет шаг «это подарок?» в покупки в Direct.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const mine = <T extends object>(r: T) => ({ bot_id: F.BUNDLE_SHOP_ID, ...r });

export function seedShop18NBundle(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.BUNDLE_SHOP_ID,
      bot_name: F.BUNDLE_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true, bundles: true, stock: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.BUNDLE_SHOP_SLUG,
        telegram: { username: "e2e_bundle18_bot", webhook_ok: true },
        admin: { username: "e2e_bundle18_seller", password_hash: hash("e2e-bundle18-pass-123") },
      },
      paused_message: null,
      owner_telegram_id: 500000118,
      owner_name: "Продавец Н18",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000118:E2E-bundle18-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    mine({ key: "shop_name", value: F.BUNDLE_SHOP_NAME, updated_at: now }),
    mine({ key: "storefront_checkout", value: '{"enabled":true}', updated_at: now }),
    mine({
      key: `bundle:${F.BUNDLE_ID}`,
      value: JSON.stringify({
        items: [
          { p: F.BUNDLE_SHAMPOO_ID, q: 2 },
          { p: F.BUNDLE_BALM_ID, q: 1 },
        ],
      }),
      updated_at: now,
    }),
  ]);
  add(db, "payment_methods", [
    mine({
      id: "e2e00000-0000-4000-8000-0000000018a5",
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
  const product = (
    id: string,
    name: string,
    price: number,
    sort: number,
    stock: number | null = null,
  ) =>
    mine({
      id,
      name,
      description: "Уход за волосами.",
      price,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      category_ids: [],
      fulfillment_kind: "physical",
      stock_quantity: stock,
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
    product(F.BUNDLE_ID, F.BUNDLE_NAME, F.BUNDLE_PRICE, 0),
    product(F.BUNDLE_SHAMPOO_ID, F.BUNDLE_SHAMPOO_NAME, 2000, 1, F.BUNDLE_SHAMPOO_STOCK),
    product(F.BUNDLE_BALM_ID, F.BUNDLE_BALM_NAME, 1500, 2, F.BUNDLE_BALM_STOCK),
    product(F.BUNDLE_TOWEL_ID, F.BUNDLE_TOWEL_NAME, 800, 3),
  ]);
}
