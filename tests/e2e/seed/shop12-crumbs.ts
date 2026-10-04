/**
 * Хлебные крошки витрины (storefront.spec.ts): отдельный магазин «Лавка К12» с
 * категориями «Школьные товары К12» › «Тетради К12» и физическим товаром внутри.
 * Категории не кладём в основной магазин: с ними бот Instagram/WhatsApp
 * показывает сначала разделы, а не товары.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, nulls } from "./util.ts";

const crumbs = <T extends object>(r: T) => ({ bot_id: F.CRUMB_SHOP_ID, ...r });

export function seedShop12Crumbs(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.CRUMB_SHOP_ID,
      bot_name: F.CRUMB_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.CRUMB_SHOP_SLUG,
        telegram: { username: "e2e_crumbs_bot", webhook_ok: true },
      },
      paused_message: null,
      owner_telegram_id: 500000012,
      owner_name: "Продавец К12",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000012:E2E-crumbs-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    crumbs({ key: "shop_name", value: F.CRUMB_SHOP_NAME, updated_at: now }),
  ]);
  add(db, "categories", [
    crumbs({
      id: F.CRUMB_PARENT_ID,
      name: F.CRUMB_PARENT_NAME,
      parent_id: null,
      is_visible: true,
      sort_order: 0,
      created_at: now,
    }),
    crumbs({
      id: F.CRUMB_CHILD_ID,
      name: F.CRUMB_CHILD_NAME,
      parent_id: F.CRUMB_PARENT_ID,
      is_visible: true,
      sort_order: 1,
      created_at: now,
    }),
  ]);
  add(db, "products", [
    crumbs({
      id: F.CRUMB_PRODUCT_ID,
      name: F.CRUMB_PRODUCT_NAME,
      description: "Тетрадь на 48 листов.",
      price: 2500,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      category_ids: [F.CRUMB_CHILD_ID],
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
    }),
  ]);
}
