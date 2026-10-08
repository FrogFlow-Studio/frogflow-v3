/** Mini App: фото и «Назад» (miniapp-photo.spec.ts): форма фото 4:5, фото и пример товара. */
import * as F from "../fixtures.ts";
import { PIXEL_PNG, type StubDb } from "../pg-stub.ts";
import { add, encrypt, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.MINIAPP_SHOP_ID, ...r });

const product = (id: string, name: string, sort: number, now: string) =>
  own({
    id,
    name,
    description: "Материал для урока.",
    keywords: "",
    price: 1500,
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
    sort_order: sort,
    created_at: now,
  });

export function seedMiniappPhoto(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.MINIAPP_SHOP_ID,
      bot_name: F.MINIAPP_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true, telegram_mini_app: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.MINIAPP_SHOP_SLUG,
        telegram: { username: "e2e_miniapp_bot", webhook_ok: true },
        storefront_design: { theme: "fresh", cover: false, blocks: [], photo: "portrait" },
      },
      paused_message: null,
      owner_telegram_id: 500000801,
      owner_name: "Продавец Т1",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000801:E2E-miniapp-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  const photos = ["p1.png", "p2.png", "p3.png"].map((f) => `${F.MINIAPP_SHOP_ID}/${f}`);
  const samples = ["s1.png", "s2.png"].map((f) => `${F.MINIAPP_SHOP_ID}/${f}`);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.MINIAPP_SHOP_NAME, updated_at: now }),
    own({
      key: `product_preview:${F.MINIAPP_PRODUCT_ID}`,
      value: JSON.stringify(samples),
      updated_at: now,
    }),
  ]);
  add(db, "products", [
    product(F.MINIAPP_PRODUCT_ID, F.MINIAPP_PRODUCT_NAME, 0, now),
    product(F.MINIAPP_PLAIN_ID, F.MINIAPP_PLAIN_NAME, 1, now),
  ]);
  add(
    db,
    "product_images",
    photos.map((image_path, i) =>
      own({
        id: `e2e00000-0000-4000-8000-0000000ba1${String(i).padStart(2, "0")}`,
        product_id: F.MINIAPP_PRODUCT_ID,
        image_path,
        sort_order: i,
        created_at: now,
      }),
    ),
  );
  for (const key of [...photos, ...samples])
    db.storage.set(`product-images/${key}`, { body: PIXEL_PNG, type: "image/png" });
}
