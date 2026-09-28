import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { applyOrder, moveItem, sortOrders } from "./reorder";

describe("порядок перетаскиванием", () => {
  it("перенос элемента вверх и вниз; вне списка — без изменений", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("номера с шагом 10 от начала страницы; записываются только переданные", async () => {
    expect(sortOrders(["x", "y"], 40)).toEqual([
      ["x", 40],
      ["y", 50],
    ]);
    const db = fakeDb();
    db.tables.categories = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
      { id: "c", sort_order: 99 },
    ];
    await applyOrder({ db } as unknown as TenantContext, "categories", ["b", "a"]);
    expect(db.tables.categories.map((r) => [r.id, r.sort_order])).toEqual([
      ["a", 20],
      ["b", 10],
      ["c", 99],
    ]);
  });
});
