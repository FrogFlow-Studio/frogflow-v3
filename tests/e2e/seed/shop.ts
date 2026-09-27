/**
 * Демо-магазин цифровых товаров на v2: бот, продавец, реквизиты по чеку и
 * Robokassa, два товара с файлами и фото.
 */
import * as F from "../fixtures.ts";
import type { Row, StubDb } from "../pg-stub.ts";
import { add, addSettings, encrypt, hash, nulls, shop } from "./util.ts";

const product = (r: Row, now: string) =>
  shop({
    currency: "KZT",
    country_prices: {},
    is_active: true,
    category_ids: [],
    fulfillment_kind: "digital",
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
    created_at: now,
    ...r,
  });

export function seedShop(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.SHOP_ID,
      bot_name: F.SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { robokassa: true, shop: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.SHOP_SLUG,
        telegram: { username: "e2e_shop_bot", webhook_ok: true },
        admin: { username: F.SELLER_LOGIN, password_hash: hash(F.SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: F.SELLER_TG,
      owner_name: "Продавец E2E",
      app_url: null,
      archived_at: null,
      bot_token: encrypt(F.BOT_TOKEN, F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);

  addSettings(db, now, [
    ["shop_name", F.SHOP_NAME],
    ["robokassa_enabled", "true"],
    ["robokassa_test_mode", "false"],
    ["robokassa_login", F.ROBOKASSA.login],
    ["robokassa_pass1", F.ROBOKASSA.pass1],
    ["robokassa_pass2", F.ROBOKASSA.pass2],
  ]);

  add(db, "payment_methods", [
    shop({
      id: "e2e00000-0000-4000-8000-0000000000b1",
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

  add(db, "products", [
    product(
      {
        id: F.PRODUCT_ID,
        name: F.PRODUCT_NAME,
        description: "Сорок страниц прописей в PDF.",
        price: F.PRODUCT_PRICE,
        sort_order: 0,
      },
      now,
    ),
    product(
      {
        id: F.UPSELL_ID,
        name: F.UPSELL_NAME,
        description: "Раскраска в PDF.",
        price: 900,
        sort_order: 1,
      },
      now,
    ),
  ]);
  add(db, "product_material_files", [
    shop({
      id: "e2e00000-0000-4000-8000-0000000000c1",
      product_id: F.PRODUCT_ID,
      language: "ru",
      file_path: F.MATERIAL_PATH,
      file_name: "propisi.pdf",
      sort_order: 0,
      created_at: now,
    }),
    shop({
      id: "e2e00000-0000-4000-8000-0000000000c2",
      product_id: F.UPSELL_ID,
      language: "ru",
      file_path: F.MATERIAL_PATH,
      file_name: "raskraska.pdf",
      sort_order: 0,
      created_at: now,
    }),
  ]);
  add(db, "product_images", [
    shop({
      id: "e2e00000-0000-4000-8000-0000000000d1",
      product_id: F.PRODUCT_ID,
      image_path: `${F.SHOP_ID}/propisi.jpg`,
      sort_order: 0,
      created_at: now,
    }),
  ]);
  add(db, "product_variants", []);
  add(db, "categories", []);

  db.storage.set(`product-files/${F.MATERIAL_PATH}`, {
    body: Buffer.from("%PDF-1.4\n% e2e\n"),
    type: "application/pdf",
  });
}
