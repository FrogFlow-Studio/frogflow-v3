/**
 * Себестоимость и прибыль (shop14-cost.spec.ts): магазин «Мастерская С14» — физический товар
 * и заказ с чеком на подтверждении, по одному на проект Playwright. В основной магазин
 * ничего не добавляем.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash, nulls } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.COST14_SHOP_ID, ...r });

export function seedShop14Cost(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.COST14_SHOP_ID,
      bot_name: F.COST14_SHOP_NAME,
      status: "active",
      vertical: "digital",
      modules: { shop: true, dashboard: true, profit: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.COST14_SHOP_SLUG,
        telegram: { username: "e2e_cost14_bot", webhook_ok: true },
        admin: { username: F.COST14_SELLER_LOGIN, password_hash: hash(F.COST14_SELLER_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000015,
      owner_name: "Продавец С14",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000015:E2E-cost14-token", F.SECRETS_KEY),
      subscription_plan: "business",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "app_settings", [own({ key: "shop_name", value: F.COST14_SHOP_NAME, updated_at: now })]);
  F.COST14_PRODUCT_IDS.forEach((productId, i) => {
    add(db, "products", [
      own({
        id: productId,
        name: F.COST14_PRODUCT_NAMES[i],
        description: "Керамическое кашпо ручной работы.",
        price: F.COST14_PRODUCT_PRICE,
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
        sort_order: i,
        created_at: now,
      }),
    ]);
    const orderId = F.COST14_ORDER_IDS[i]!;
    add(db, "orders", [
      own({
        id: orderId,
        order_no: i + 1,
        display_no: i + 1,
        status: "awaiting_confirmation",
        platform: "telegram",
        telegram_id: 600000015 + i,
        user_key: `tg_${600000015 + i}`,
        display_name: "Анна",
        username: null,
        total: F.COST14_PRODUCT_PRICE,
        paid_amount: 0,
        currency: "KZT",
        fulfillment_kind: "physical",
        created_at: now,
        updated_at: now,
      }),
    ]);
    add(db, "order_items", [
      own({
        id: F.COST14_ITEM_IDS[i],
        order_id: orderId,
        product_id: productId,
        product_variant_id: null,
        name_snapshot: F.COST14_PRODUCT_NAMES[i],
        quantity: 1,
        price_snapshot: F.COST14_PRODUCT_PRICE,
      }),
    ]);
  });
}
