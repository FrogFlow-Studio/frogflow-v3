import { describe, expect, it } from "vitest";
import {
  parseVariantMaterials,
  resolveVariantMaterial,
  variantMaterialsKey,
  type VariantMaterialsMap,
} from "./variant-materials";

describe("variant-materials", () => {
  it("key generates correct app_settings prefix", () => {
    expect(variantMaterialsKey("prod-123")).toBe("variant_materials:prod-123");
  });

  it("parseVariantMaterials handles empty or invalid json safely", () => {
    expect(parseVariantMaterials(null)).toEqual({});
    expect(parseVariantMaterials("")).toEqual({});
    expect(parseVariantMaterials("{invalid json")).toEqual({});
    expect(parseVariantMaterials("[]")).toEqual({});
    expect(parseVariantMaterials("123")).toEqual({});
  });

  it("parseVariantMaterials parses valid mapping", () => {
    const raw = JSON.stringify({
      v1: { filePath: "bot/5_klass.pdf", fileName: "5 класс.pdf" },
      v2: { filePath: "bot/6_klass.pdf", fileName: null },
      invalid: { filePath: "" },
    });
    const parsed = parseVariantMaterials(raw);
    expect(parsed).toEqual({
      v1: { filePath: "bot/5_klass.pdf", fileName: "5 класс.pdf" },
      v2: { filePath: "bot/6_klass.pdf", fileName: null },
    });
  });

  it("resolveVariantMaterial matches by ID, exact name, or case-insensitive name", () => {
    const map: VariantMaterialsMap = {
      "uuid-5": { filePath: "5.pdf", fileName: "5 класс" },
      "6 класс": { filePath: "6.pdf", fileName: "6 класс" },
    };

    // By ID
    expect(resolveVariantMaterial(map, "uuid-5", "Something else")).toEqual({
      filePath: "5.pdf",
      fileName: "5 класс",
    });

    // By Name
    expect(resolveVariantMaterial(map, "uuid-unknown", "6 класс")).toEqual({
      filePath: "6.pdf",
      fileName: "6 класс",
    });

    // By case-insensitive Name
    expect(resolveVariantMaterial(map, null, "  6 КЛАСС  ")).toEqual({
      filePath: "6.pdf",
      fileName: "6 класс",
    });

    // Not found
    expect(resolveVariantMaterial(map, "uuid-none", "7 класс")).toBeNull();
  });
});
