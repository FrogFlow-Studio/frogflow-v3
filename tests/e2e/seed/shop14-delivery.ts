/**
 * Выдача заказов (shop14-delivery.spec.ts): отдельный магазин «Пекарня Д14» —
 * физический товар, самовывоз и доставка, воскресенье без выдачи. В основной
 * магазин ничего не добавляем: его бот и каталог нужны другим сценариям.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.DELIVERY_SHOP_ID, ...r });

export function seedShop14Delivery(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.DELIVERY_SHOP_ID,
      bot_name: F.DELIVERY_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.DELIVERY_SHOP_SLUG,
        telegram: { username: "e2e_pekarnya_bot", webhook_ok: true },
      },
      paused_message: null,
      owner_telegram_id: 500000014,
      owner_name: "Продавец Д14",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000014:E2E-pekarnya-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [
    own({ key: "shop_name", value: F.DELIVERY_SHOP_NAME, updated_at: now }),
    own({ key: "storefront_checkout", value: '{"enabled":true}', updated_at: now }),
    own({ key: "fulfillment_closed_weekdays", value: "7", updated_at: now }),
  ]);
  add(db, "payment_methods", [
    own({
      id: "e2e00000-0000-4000-8000-0000000000d2",
      country_code: "KZ",
      country_name: "Казахстан",
      currency: "KZT",
      instructions: "Переведите сумму на Kaspi Gold 4400 0000 0000 0001 и пришлите чек.",
      qr_code_path: null,
      is_active: true,
      sort_order: 0,
      created_at: now,
    }),
  ]);
  add(db, "products", [
    own({
      id: F.DELIVERY_PRODUCT_ID,
      name: F.DELIVERY_PRODUCT_NAME,
      description: "Слоёный торт с заварным кремом.",
      price: F.DELIVERY_PRODUCT_PRICE,
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
    }),
  ]);
}
