/**
 * Акция со сроком (shop4-sale.spec.ts): модуль «Ограниченные предложения» и
 * идущая акция на отдельный товар — 25 % на 2000 ₸ (в базе только акция,
 * без админки: создание акции проверено тестами core/offers/admin).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, addSettings, nulls, shop, shopBot } from "./util.ts";

export function seedShop4Sale(db: StubDb, now: string) {
  const bot = shopBot(db);
  bot.modules = { ...(bot.modules as object), limited_offers: true };
  add(db, "products", [
    shop({
      id: F.SALE_PRODUCT_ID,
      name: F.SALE_PRODUCT_NAME,
      description: "Товар с идущей акцией.",
      price: F.SALE_PRODUCT_PRICE,
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
      sort_order: 20,
      created_at: now,
    }),
  ]);
  const day = 86_400_000;
  addSettings(db, now, [
    [
      "limited_offers",
      JSON.stringify([
        {
          id: "lo_e2e",
          product_id: F.SALE_PRODUCT_ID,
          percent: F.SALE_PERCENT,
          starts_at: new Date(Date.now() - day).toISOString(),
          ends_at: new Date(Date.now() + 30 * day).toISOString(),
          limit: null,
        },
      ]),
    ],
  ]);
}
