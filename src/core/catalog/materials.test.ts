import { describe, expect, it } from "vitest";
import {
  editableMaterials,
  materialCount,
  materialLanguages,
  materialsForProduct,
  productSellable,
} from "./materials";

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

  it("не путает языки — включая en/uz, не только ru/kk", () => {
    const p = {
      product_material_files: [
        { language: "kk", file_path: "kk.pdf", file_name: "KK", sort_order: 1 },
        { language: "en", file_path: "en.pdf", file_name: "EN", sort_order: 1 },
        { language: "uz", file_path: "uz.pdf", file_name: "UZ", sort_order: 1 },
      ],
    };
    expect(materialsForProduct(p, "ru")).toEqual([]);
    expect(materialsForProduct(p, "kk").map((m) => m.path)).toEqual(["kk.pdf"]);
    expect(materialsForProduct(p, "en").map((m) => m.path)).toEqual(["en.pdf"]);
    expect(materialsForProduct(p, "uz").map((m) => m.path)).toEqual(["uz.pdf"]);
  });

  it("у товара без файлов не выдумывает материал", () => {
    expect(materialsForProduct({}, "ru")).toEqual([]);
    expect(materialsForProduct(null, "ru")).toEqual([]);
    expect(materialsForProduct(undefined, "kk")).toEqual([]);
  });

  it("продаваемость считается так же, как снимок, по всем 4 языкам", () => {
    expect(productSellable({ file_path_kz: "kz/file.pdf" })).toBe(true);
    expect(
      productSellable({ product_material_files: [{ language: "uz", file_path: "u.pdf" }] }),
    ).toBe(true);
    expect(productSellable({})).toBe(false);
    // Запись без пути файлом не является, сколько бы строк ни было в таблице.
    expect(
      productSellable({
        fulfillment_kind: "digital",
        product_material_files: [{ language: "ru", file_path: null }],
      }),
    ).toBe(false);
  });

  it("пустой массив, если у товара нет ни ссылки, ни пути", () => {
    for (const lang of ["ru", "kk", "en", "uz"] as const) {
      expect(materialsForProduct({ file_name: "Материал" }, lang)).toEqual([]);
      expect(materialsForProduct(null, lang)).toEqual([]);
    }
  });
});

describe("форма админки и список товаров видят старый файл v1", () => {
  const v1 = {
    fulfillment_kind: "digital",
    file_path: "1786287439581-c8fvy2.pdf",
    file_name: "Фотобутафория.pdf",
    product_material_files: [],
  };

  it("файл только в products.file_path — одна строка ru в форме и 1 в списке", () => {
    expect(editableMaterials(v1)).toEqual([
      { language: "ru", filePath: "1786287439581-c8fvy2.pdf", fileName: "Фотобутафория.pdf" },
    ]);
    expect(materialCount(v1)).toBe(1);
  });

  it("казахский файл в file_path_kz — строка kk", () => {
    const p = { ...v1, file_path_kz: "kz.pdf", file_name_kz: "kz.pdf" };
    expect(editableMaterials(p).map((m) => m.language)).toEqual(["ru", "kk"]);
    expect(materialCount(p)).toBe(2);
  });

  it("есть строки product_material_files — берутся они, по порядку", () => {
    const p = {
      ...v1,
      product_material_files: [
        { language: "kk", file_path: "b/2.pdf", file_name: "2", sort_order: 1 },
        { language: "ru", file_path: "b/1.pdf", file_name: "1", sort_order: 0 },
      ],
    };
    expect(editableMaterials(p).map((m) => m.filePath)).toEqual(["b/1.pdf", "b/2.pdf"]);
    expect(materialCount(p)).toBe(2);
  });

  it("без файлов вовсе — пусто и 0", () => {
    expect(editableMaterials({ fulfillment_kind: "digital" })).toEqual([]);
    expect(materialCount({ fulfillment_kind: "digital" })).toBe(0);
  });
});
