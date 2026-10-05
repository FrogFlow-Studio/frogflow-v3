import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";

/**
 * Применение импорта на базе в памяти: артикул связывает товар с файлом,
 * повторная загрузка не задваивает ни товары, ни фото, строка с ошибкой не
 * ломает остальные. Сеть заменена только на скачивание картинки (оно
 * проверяется отдельно, getPinned).
 */
const BOT_ID = vi.hoisted(() => "b41a34cb-7944-441b-8f71-503184fc0f1f");
const state = vi.hoisted(() => ({
  db: null as unknown,
  patches: [] as Array<Record<string, unknown>>,
  downloads: [] as string[],
  failUrl: "" as string,
  settings: {} as Record<string, string>,
  skus: {} as Record<string, string>,
}));

vi.mock("@/core/tenant/resolve.server", () => ({
  patchTenantSettings: async (_id: string, patch: Record<string, unknown>) => {
    state.patches.push(patch);
    Object.assign(state.skus, patch.catalog_skus as Record<string, string>);
  },
}));
vi.mock("@/core/settings/settings", () => ({ getSetting: async () => "KZT" }));
vi.mock("./stock-history", () => ({ recordStockChange: async () => {} }));
vi.mock("./import-photo.server", () => ({
  storeImportPhoto: async (_ctx: unknown, url: string) => {
    state.downloads.push(url);
    if (url === state.failUrl) return { ok: false, reason: "ответ 404" };
    return {
      ok: true,
      key: `${BOT_ID}/${state.downloads.length.toString(16).padStart(24, "0")}.jpg`,
    };
  },
}));

const { applyImport, previewImport } = await import("./import.server");

const BOT = BOT_ID;
function ctx(fresh = false) {
  if (fresh || !state.db) {
    state.db = fakeDb();
    state.skus = {};
    state.downloads = [];
  }
  return {
    tenant: { id: BOT, settings: { catalog_skus: { ...state.skus } } },
    db: state.db,
  } as never;
}
const tables = () =>
  (state.db as { tables: Record<string, Array<Record<string, unknown>>> }).tables;

const FILE = [
  "Артикул;Название;Цена;Фото",
  "A-1;Торт;1500;https://cdn.example/a1.jpg https://cdn.example/a2.jpg",
  "B-2;Пирог;900;https://cdn.example/bad.jpg",
  ";Без цены;abc;",
  "C-3;Эклер;300;",
].join("\n");

describe("импорт: артикул, повторная загрузка, фото", () => {
  it("первая загрузка создаёт товары, запоминает артикулы, кладёт фото; битая строка не мешает", async () => {
    state.failUrl = "https://cdn.example/bad.jpg";
    const c = ctx(true);
    const r = await applyImport(c, FILE);
    expect(r.created).toBe(3);
    expect(r.errors.some((e) => e.startsWith("строка 4:"))).toBe(true);
    expect(
      tables()
        .products!.map((p) => p.name)
        .sort(),
    ).toEqual(["Пирог", "Торт", "Эклер"]);
    expect(Object.keys(state.skus).sort()).toEqual(["a-1", "b-2", "c-3"]);
    // у «Торта» два фото, у «Пирога» ссылка не скачалась — фото нет, но это в предупреждениях
    const cake = tables().products!.find((p) => p.name === "Торт")!;
    expect(tables().product_images!.filter((i) => i.product_id === cake.id)).toHaveLength(2);
    expect(r.photosAdded).toBe(1);
    expect(r.warnings.some((w) => w.includes("ответ 404"))).toBe(true);
  });

  it("повторная загрузка того же файла: ни новых товаров, ни дублей фото; недостающее фото докачивается", async () => {
    state.failUrl = "";
    const c = ctx();
    const before = tables().products!.length;
    const r = await applyImport(c, FILE);
    expect(r.created).toBe(0);
    expect(r.updated).toBe(3);
    expect(tables().products).toHaveLength(before);
    const cake = tables().products!.find((p) => p.name === "Торт")!;
    // фото «Торта» уже были — не задвоились
    expect(tables().product_images!.filter((i) => i.product_id === cake.id)).toHaveLength(2);
    // у «Пирога» фото не было — докачалось
    const pie = tables().products!.find((p) => p.name === "Пирог")!;
    expect(tables().product_images!.filter((i) => i.product_id === pie.id)).toHaveLength(1);
  });

  it("переименованный товар находится по артикулу, а не создаётся заново", async () => {
    const c = ctx();
    const r = await applyImport(c, "Артикул;Название;Цена\nA-1;Торт «Медовик»;1700");
    expect(r.created).toBe(0);
    expect(r.updated).toBe(1);
    const names = tables().products!.map((p) => p.name);
    expect(names).toContain("Торт «Медовик»");
    expect(names).not.toContain("Торт");
    expect(tables().products!.find((p) => p.name === "Торт «Медовик»")!.price).toBe(1700);
  });

  it("предпросмотр считает фото и ничего не пишет", async () => {
    const c = ctx();
    const n = tables().products!.length;
    const p = await previewImport(c, FILE);
    expect(p.withPhotos).toBe(2);
    expect(tables().products).toHaveLength(n);
  });
});
