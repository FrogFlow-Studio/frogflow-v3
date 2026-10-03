/**
 * Фильтры витрины (shop4-filters.spec.ts): у демо-магазина включён модуль «Склад»,
 * а набор с базовой ценой 3000 ₸ имеет вариант за 400 ₸ — в «до 1000» он должен попасть.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, nulls, shop, shopBot } from "./util.ts";

export function seedShop4Filters(db: StubDb, now: string) {
  const bot = shopBot(db);
  bot.modules = { ...(bot.modules as object), stock: true };
  add(db, "products", [
    shop({
      id: F.VARIANT_PRODUCT_ID,
      name: F.VARIANT_PRODUCT_NAME,
      description: "Есть мини-вариант.",
      price: 3000,
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
      sort_order: 10,
      created_at: now,
    }),
  ]);
  add(db, "product_variants", [
    shop({
      id: "e2e00000-0000-4000-8000-0000000000d5",
      product_id: F.VARIANT_PRODUCT_ID,
      name: "Мини",
      price: 400,
      sort_order: 0,
    }),
  ]);
}
