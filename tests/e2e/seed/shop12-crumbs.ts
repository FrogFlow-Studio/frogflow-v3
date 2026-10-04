/**
 * Хлебные крошки витрины (storefront.spec.ts): «Школьные товары К12» › «Тетради К12»
 * и физический товар во вложенной категории. Название и цена не пересекаются с
 * товарами других сценариев (фильтры цены, «Прописи»).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, nulls, shop } from "./util.ts";

export function seedShop12Crumbs(db: StubDb, now: string) {
  add(db, "categories", [
    shop({
      id: F.CRUMB_PARENT_ID,
      name: F.CRUMB_PARENT_NAME,
      parent_id: null,
      is_visible: true,
      sort_order: 50,
      created_at: now,
    }),
    shop({
      id: F.CRUMB_CHILD_ID,
      name: F.CRUMB_CHILD_NAME,
      parent_id: F.CRUMB_PARENT_ID,
      is_visible: true,
      sort_order: 51,
      created_at: now,
    }),
  ]);
  add(db, "products", [
    shop({
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
      sort_order: 60,
      created_at: now,
    }),
  ]);
}
