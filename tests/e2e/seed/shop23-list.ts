/** Листание без потерь (shop23-list.spec.ts): магазин «Листание Т23», 50 материалов. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.LIST23_SHOP_ID, ...r });

export function seedShop23List(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.LIST23_SHOP_ID,
      bot_name: F.LIST23_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, web_storefront: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.LIST23_SHOP_SLUG,
        telegram: { username: "e2e_list23_bot", webhook_ok: true },
      },
      paused_message: null,
      owner_telegram_id: 500000123,
      owner_name: "Продавец Листание Т23",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000123:E2E-list23-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.LIST23_SHOP_NAME, updated_at: now })]);
  add(
    db,
    "products",
    Array.from({ length: F.LIST23_COUNT }, (_, i) =>
      own({
        id: F.list23Id(i + 1),
        name: F.list23Name(i + 1),
        description: `Описание материала ${i + 1}`,
        keywords: "",
        price: 1000 + i,
        currency: "KZT",
        country_prices: {},
        is_active: true,
        category_ids: [],
        fulfillment_kind: "physical",
        stock_quantity: 5,
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
        sort_order: i + 1,
        created_at: now,
      }),
    ),
  );
}
