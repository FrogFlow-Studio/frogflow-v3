import { describe, expect, it } from "vitest";
import { productReadiness, rowReadiness, type ReadinessInput } from "./readiness";

const full: ReadinessInput = {
  name: "Набор",
  description: "Описание",
  price: 1500,
  variants: 0,
  photos: 3,
  categories: 1,
  kind: "digital",
  files: 1,
  isCourse: false,
};

describe("готовность карточки", () => {
  it("всё заполнено — готово, 100%", () => {
    expect(productReadiness(full)).toMatchObject({ ready: true, percent: 100, missing: [] });
  });

  it("пример: нет цены и двух фото из трёх", () => {
    const r = productReadiness({ ...full, price: null, photos: 1 });
    expect(r.missing).toEqual([{ key: "price" }, { key: "photos", count: 2 }]);
    expect(r.ready).toBe(false);
    expect(r.done).toBe(4);
    expect(r.percent).toBe(67);
  });

  it("цена у вариантов заменяет общую цену", () => {
    expect(productReadiness({ ...full, price: 0, variants: 2 }).missing).toEqual([]);
    expect(productReadiness({ ...full, price: 0, variants: 0 }).missing).toEqual([
      { key: "price" },
    ]);
  });

  it("пробелы вместо названия и описания — не заполнено", () => {
    const keys = productReadiness({ ...full, name: "  ", description: "\n" }).missing.map(
      (g) => g.key,
    );
    expect(keys).toEqual(["name", "description"]);
  });

  it("файл нужен только цифровому товару, не курсу и не физическому", () => {
    expect(productReadiness({ ...full, files: 0 }).missing).toEqual([{ key: "file" }]);
    expect(productReadiness({ ...full, files: 0, isCourse: true }).ready).toBe(true);
    const phys = productReadiness({ ...full, files: 0, kind: "physical" });
    expect(phys.ready).toBe(true);
    expect(phys.total).toBe(5);
  });

  it("без категории не готово", () => {
    expect(productReadiness({ ...full, categories: 0 }).missing).toEqual([{ key: "category" }]);
  });
});

describe("готовность по строке списка", () => {
  const row = {
    name: "Набор",
    price: 1500,
    variants: 0,
    images: 3,
    files: 1,
    fulfillment_kind: "digital",
    category_ids: ["c1"],
    has_description: true,
    is_course: false,
  };
  it("совпадает с расчётом по полям карточки", () => {
    expect(rowReadiness(row)).toEqual(productReadiness(full));
    const r = rowReadiness({ ...row, images: 1, price: 0, category_ids: null });
    expect(r.missing.map((g) => g.key)).toEqual(["price", "photos", "category"]);
  });
});
