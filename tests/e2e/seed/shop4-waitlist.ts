/**
 * Лист ожидания с сайта (shop4-waitlist.spec.ts): модуль waitlist, склад и
 * физический товар с нулевым остатком.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, nulls, shop, shopBot } from "./util.ts";

export function seedShop4Waitlist(db: StubDb, now: string) {
  const bot = shopBot(db);
  bot.modules = { ...(bot.modules as object), stock: true, waitlist: true };
  add(db, "products", [
    shop({
      id: F.SOLDOUT_ID,
      name: F.SOLDOUT_NAME,
      description: "Нет на складе.",
      price: 700,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      category_ids: [],
      fulfillment_kind: "physical",
      stock_quantity: 0,
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
      sort_order: 9,
      created_at: now,
    }),
  ]);
}
