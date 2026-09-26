import { describe, expect, it } from "vitest";
import { backInStock, inStock, withWaitlist, withoutWaitlist } from "./waitlist";

describe("лист ожидания — чистые правила", () => {
  it("добавление без дублей, свежий первым; удаление", () => {
    expect(withWaitlist(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(withWaitlist(undefined, "x")).toEqual(["x"]);
    expect(withoutWaitlist(["a", "b"], "a")).toEqual(["b"]);
  });
  it("в продаже: включён и остаток не ноль (пусто — безлимит)", () => {
    expect(inStock({ is_active: true, stock_quantity: null })).toBe(true);
    expect(inStock({ is_active: true, stock_quantity: 0 })).toBe(false);
    expect(inStock({ is_active: false, stock_quantity: 5 })).toBe(false);
  });
  it("вернулся в продажу — только переход из «нет» в «есть»", () => {
    expect(
      backInStock({ is_active: true, stock_quantity: 0 }, { is_active: true, stock_quantity: 3 }),
    ).toBe(true);
    expect(
      backInStock({ is_active: false, stock_quantity: 3 }, { is_active: true, stock_quantity: 3 }),
    ).toBe(true);
    expect(
      backInStock({ is_active: true, stock_quantity: 2 }, { is_active: true, stock_quantity: 5 }),
    ).toBe(false);
    expect(backInStock(null, { is_active: true, stock_quantity: 5 })).toBe(false);
  });
});
