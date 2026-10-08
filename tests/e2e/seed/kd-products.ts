/** Список товаров админки (kd-products.spec.ts): магазин «Дидактика Т», четыре товара. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.KDP_SHOP_ID, ...r });

export function seedKdProducts(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.KDP_SHOP_ID,
      bot_name: F.KDP_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.KDP_SHOP_SLUG,
        telegram: { username: "e2e_kdp_bot", webhook_ok: true },
        admin: { username: F.KDP_SELLER_LOGIN, password_hash: hash(F.KDP_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000457,
      owner_name: "Продавец КД",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000457:E2E-kdp-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.KDP_SHOP_NAME, updated_at: now })]);
  add(
    db,
    "products",
    F.KDP_PRODUCTS.map(([id, name, created, kk, physical], i) =>
      own({
        id,
        name,
        description: "Материал для урока.",
        keywords: name === "Слоги КД" ? `${F.KDP_CODE}, слоги` : "",
        price: 1500,
        currency: "KZT",
        country_prices: {},
        is_active: true,
        category_ids: [],
        fulfillment_kind: physical ? "physical" : "digital",
        stock_quantity: null,
        lead_time_days: null,
        ...nulls(["file_name", "file_url", "file_name_kz", "file_url_kz", "rating_avg"]),
        file_path: physical ? null : `${F.KDP_SHOP_ID}/ru-${i}.pdf`,
        file_path_kz: kk === "legacy" ? `${F.KDP_SHOP_ID}/kz-${i}.pdf` : null,
        rating_count: 0,
        sort_order: i,
        created_at: created,
      }),
    ),
  );
  add(db, "product_material_files", [
    own({
      id: "e2e2a100-0000-4000-8000-000000000201",
      product_id: F.KDP_PRODUCTS[0][0],
      language: "kk",
      file_path: `${F.KDP_SHOP_ID}/kz-table.pdf`,
      file_name: "azbuka-kz.pdf",
      sort_order: 0,
      created_at: now,
    }),
  ]);
}
