import { describe, expect, it } from "vitest";
import { productCategoryIds } from "@/core/catalog/category-ids";
import { apiProduct } from "@/core/api/public-api";

describe("productCategoryIds", () => {
  it("товар перенесён в другую категорию: старая колонка не считается", () => {
    expect(productCategoryIds({ category_id: "old", category_ids: ["new"] })).toEqual(["new"]);
  });
  it("массива нет или он пуст: запасной category_id", () => {
    expect(productCategoryIds({ category_id: "old", category_ids: [] })).toEqual(["old"]);
    expect(productCategoryIds({ category_id: "old", category_ids: null })).toEqual(["old"]);
    expect(productCategoryIds({ category_id: null, category_ids: [] })).toEqual([]);
  });
  it("публичный API отдаёт новую категорию", () => {
    const out = apiProduct({
      id: "p",
      name: "n",
      price: 1,
      currency: "KZT",
      is_active: true,
      stock_quantity: null,
      fulfillment_kind: "digital",
      category_id: "old",
      category_ids: ["new"],
      sort_order: 0,
      description: "",
    });
    expect(out.category_id).toBe("new");
    expect(out.category_ids).toEqual(["new"]);
  });
});
