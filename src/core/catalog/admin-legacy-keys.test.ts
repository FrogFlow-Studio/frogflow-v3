import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { setProductImages, setProductMaterials } from "./admin";

const BOT = "00000000-0000-0000-0000-000000000001";
const LEGACY_IMG = "1783414427610-x7i24b.jpeg";
const LEGACY_PDF = "1782643012614-ni1xub.pdf";

function setup() {
  const db = fakeDb();
  db.tables.product_images = [
    { bot_id: BOT, product_id: "p1", image_path: LEGACY_IMG, sort_order: 0 },
  ];
  db.tables.product_material_files = [
    {
      bot_id: BOT,
      product_id: "p1",
      language: "ru",
      file_path: LEGACY_PDF,
      file_name: "Пазлы.pdf",
      sort_order: 0,
    },
  ];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { db, ctx };
}

describe("товар v1 со старыми файлами без префикса сохраняется в админке v2", () => {
  it("картинки: старый ключ остаётся, новый добавляется", async () => {
    const { db, ctx } = setup();
    await setProductImages(ctx, "p1", [LEGACY_IMG, `${BOT}/0a1b2c3d4e5f60718293a4b5.png`]);
    expect(db.tables.product_images!.map((r) => r.image_path)).toEqual([
      LEGACY_IMG,
      `${BOT}/0a1b2c3d4e5f60718293a4b5.png`,
    ]);
  });

  it("материалы: старый файл остаётся при сохранении", async () => {
    const { db, ctx } = setup();
    await setProductMaterials(ctx, "p1", [
      { language: "ru", filePath: LEGACY_PDF, fileName: "Пазлы.pdf" },
    ]);
    expect(db.tables.product_material_files!.map((r) => r.file_path)).toEqual([LEGACY_PDF]);
  });

  it("чужой старый ключ, которого у товара не было, не принимается", async () => {
    const { db, ctx } = setup();
    await expect(setProductImages(ctx, "p1", ["9999999999999-zzzz.jpeg"])).rejects.toThrow(
      /префикс/,
    );
    await expect(
      setProductMaterials(ctx, "p2", [{ language: "ru", filePath: LEGACY_PDF, fileName: null }]),
    ).rejects.toThrow(/префикс/);
    // Ничего не стёрто.
    expect(db.tables.product_images).toHaveLength(1);
    expect(db.tables.product_material_files).toHaveLength(1);
  });

  it("материалы: файл только в старом поле products.file_path (Print KZ Art 0001–0027) сохраняется", async () => {
    const { db, ctx } = setup();
    db.tables.products = [
      { id: "p3", bot_id: BOT, file_path: "1786287439581-c8fvy2.pdf", file_path_kz: null },
    ];
    await setProductMaterials(ctx, "p3", [
      { language: "ru", filePath: "1786287439581-c8fvy2.pdf", fileName: "Фотобутафория.pdf" },
    ]);
    expect(
      db.tables
        .product_material_files!.filter((r) => r.product_id === "p3")
        .map((r) => r.file_path),
    ).toEqual(["1786287439581-c8fvy2.pdf"]);
    // Чужой старый ключ по-прежнему не проходит.
    await expect(
      setProductMaterials(ctx, "p3", [{ language: "ru", filePath: LEGACY_PDF, fileName: null }]),
    ).rejects.toThrow(/префикс/);
  });
});
