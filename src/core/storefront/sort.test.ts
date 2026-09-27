import { describe, expect, it } from "vitest";
import { parseCatalogSort, sortCatalog } from "./sort";

// Те же товары, что в тесте v1 tests/mini-app-catalog.test.ts.
const rows = [
  { id: "old", rating_count: 1, rating_avg: 5, created_at: "2026-01-01T00:00:00Z", price: 500 },
  { id: "hit", rating_count: 40, rating_avg: 4.5, created_at: "2026-03-01T00:00:00Z", price: 900 },
  {
    id: "fresh",
    rating_count: 0,
    rating_avg: null,
    created_at: "2026-06-01T00:00:00Z",
    price: 300,
  },
];
const ids = (r: typeof rows) => r.map((x) => x.id);

describe("сортировка каталога витрины", () => {
  it("по популярности, новизне и цене; по умолчанию — порядок продавца", () => {
    expect(ids(sortCatalog(rows, "popular"))).toEqual(["hit", "old", "fresh"]);
    expect(ids(sortCatalog(rows, "new"))).toEqual(["fresh", "hit", "old"]);
    expect(sortCatalog(rows, "price").map((r) => r.price)).toEqual([300, 500, 900]);
    expect(ids(sortCatalog(rows, "catalog"))).toEqual(["old", "hit", "fresh"]);
    expect(ids(rows)).toEqual(["old", "hit", "fresh"]);
  });

  it("при равном числе отзывов выше средняя оценка", () => {
    const tie = [
      { id: "a", rating_count: 3, rating_avg: "4.1" },
      { id: "b", rating_count: 3, rating_avg: "4.9" },
    ];
    expect(sortCatalog(tie, "popular").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("неизвестное значение из адреса — порядок продавца", () => {
    expect(parseCatalogSort("price")).toBe("price");
    expect(parseCatalogSort("<x>")).toBe("catalog");
    expect(parseCatalogSort(undefined)).toBe("catalog");
  });
});
