import { describe, expect, it } from "vitest";
import { categoryPaths } from "./category-paths";

describe("categoryPaths", () => {
  it("одинаковые подразделы различаются родителем", () => {
    const p = categoryPaths([
      { id: "kg", name: "Сад", parent_id: null },
      { id: "sc", name: "Школа", parent_id: null },
      { id: "m1", name: "Математика", parent_id: "kg" },
      { id: "m2", name: "Математика", parent_id: "sc" },
      { id: "g", name: "Геометрия", parent_id: "m2" },
    ]);
    expect(p.get("m1")).toBe("Сад › Математика");
    expect(p.get("m2")).toBe("Школа › Математика");
    expect(p.get("g")).toBe("Школа › Математика › Геометрия");
    expect(p.get("kg")).toBe("Сад");
  });

  it("цикл и потерянный родитель не ломают путь", () => {
    const p = categoryPaths([
      { id: "a", name: "A", parent_id: "b" },
      { id: "b", name: "B", parent_id: "a" },
      { id: "c", name: "C", parent_id: "gone" },
    ]);
    expect(p.get("a")).toBe("B › A");
    expect(p.get("c")).toBe("C");
  });
});
