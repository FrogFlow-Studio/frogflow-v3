import { describe, expect, it } from "vitest";
import { materialLanguages, materialsForProduct, productSellable } from "./materials";

describe("materials", () => {
  it("product_material_files важнее старых одиночных полей и сортируются", () => {
    const p = {
      file_path: "old.pdf",
      product_material_files: [
        { language: "ru", file_path: "b.pdf", sort_order: 2 },
        { language: "ru", file_path: "a.pdf", sort_order: 1 },
        { language: "kk", file_path: "k.pdf" },
      ],
    };
    expect(materialsForProduct(p, "ru").map((m) => m.path)).toEqual(["a.pdf", "b.pdf"]);
    expect(materialsForProduct(p, "kk").map((m) => m.path)).toEqual(["k.pdf"]);
    expect(materialLanguages(p)).toEqual(["ru", "kk"]);
  });

  it("старые поля — запасной путь только для ru и kk", () => {
    expect(materialsForProduct({ file_url: "https://x" }, "ru")).toEqual([
      { path: null, name: null, url: "https://x" },
    ]);
    expect(materialsForProduct({ file_path_kz: "kz.pdf", file_name_kz: "KZ" }, "kk")[0]?.name).toBe(
      "KZ",
    );
    expect(materialsForProduct({ file_path: "x" }, "en")).toEqual([]);
  });

  it("цифровой товар без файлов не продаётся, физический — всегда", () => {
    expect(productSellable({ fulfillment_kind: "digital" })).toBe(false);
    expect(productSellable({ fulfillment_kind: "digital", file_path: "x" })).toBe(true);
    expect(productSellable({ fulfillment_kind: "physical" })).toBe(true);
    expect(productSellable(null)).toBe(false);
  });
});
