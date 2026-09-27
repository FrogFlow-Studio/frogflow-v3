import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeCatalogPage, STORE_PAGE } from "./catalog";

/**
 * Витрина страницами: все 459 товаров AATeach доступны через «Показать
 * ещё», без потолка в 200, страницы не перекрываются и не теряют товары,
 * сортировка — по всему каталогу, скрытые категории и цифровые без файлов
 * не показываются.
 */
const BOT = "00000000-0000-0000-0000-000000000001";
const HIDDEN = "00000000-0000-4000-8000-00000000c0de";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function shop(count: number) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.products = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      id: id(n),
      bot_id: BOT,
      name: `Прописи ${String(n).padStart(4, "0")}`,
      description: "",
      price: 10_000 - n,
      currency: "KZT",
      country_prices: {},
      // 7-й — снят с продажи, 11-й — в скрытой категории, 13-й — цифровой без файлов.
      is_active: n !== 7,
      sort_order: n,
      fulfillment_kind: n === 13 ? "digital" : "physical",
      stock_quantity: null,
      category_ids: n === 11 ? [HIDDEN] : [],
      rating_count: n % 3,
      rating_avg: 4,
      created_at: new Date(Date.UTC(2026, 0, 1) + n * 3_600_000).toISOString(),
      product_images: [],
      product_variants: [],
      product_material_files: [],
    };
  });
  db.tables.categories = [{ id: HIDDEN, name: "Скрытая", parent_id: null, is_visible: false }];
  return { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext;
}

async function all(ctx: TenantContext, sort?: "new" | "price" | "popular") {
  const out: string[] = [];
  for (let pages = 0; pages < 50; pages++) {
    const r = await storeCatalogPage(ctx, { sort, offset: out.length });
    out.push(...r.items.map((p) => p.name));
    if (!r.hasMore) return { names: out, pages: pages + 1 };
  }
  throw new Error("страницы не кончились");
}

describe("каталог витрины страницами", () => {
  it("все 456 видимых товаров из 459, без повторов и потерь", async () => {
    const ctx = shop(459);
    const { names, pages } = await all(ctx);
    expect(names).toHaveLength(456);
    expect(new Set(names).size).toBe(456);
    expect(pages).toBe(Math.ceil(456 / STORE_PAGE));
    for (const hidden of ["Прописи 0007", "Прописи 0011", "Прописи 0013"])
      expect(names).not.toContain(hidden);
    expect(names.at(-1)).toBe("Прописи 0459");
  });

  it("«Новые» и «Цена» — по всему каталогу: первая страница начинается с конца порядка продавца", async () => {
    const ctx = shop(459);
    const first = await storeCatalogPage(ctx, { sort: "new" });
    expect(first.items.slice(0, 2).map((p) => p.name)).toEqual(["Прописи 0459", "Прописи 0458"]);
    expect(first.hasMore).toBe(true);
    const { names } = await all(ctx, "price");
    expect(names[0]).toBe("Прописи 0459");
    expect(names).toHaveLength(456);
  });

  it("«Популярные»: страницы стыкуются без повторов при равных оценках", async () => {
    const { names } = await all(shop(459), "popular");
    expect(new Set(names).size).toBe(456);
  });

  it("маленький магазин — одна страница, без «Показать ещё»", async () => {
    const r = await storeCatalogPage(shop(10), {});
    expect(r.items).toHaveLength(9);
    expect(r.hasMore).toBe(false);
  });

  it("язык фильтруется на сервере до деления на страницы, чипы — по всему каталогу", async () => {
    const ctx = shop(200);
    const rows = (ctx.db as unknown as { tables: { products: Array<Record<string, unknown>> } })
      .tables.products;
    (ctx.tenant.modules as Record<string, boolean>).multi_language = true;
    // Казахская версия есть только у последних 10 товаров — дальше первой страницы.
    for (const p of rows.slice(190))
      p.product_material_files = [
        { id: `${p.id}-kk`, language: "kk", file_path: "x.pdf", file_name: "x.pdf" },
        { id: `${p.id}-ru`, language: "ru", file_path: "y.pdf", file_name: "y.pdf" },
      ];
    for (const p of rows.slice(0, 190))
      p.product_material_files = [
        { id: `${p.id}-ru`, language: "ru", file_path: "y.pdf", file_name: "y.pdf" },
      ];
    const first = await storeCatalogPage(ctx, {});
    expect(first.languages).toEqual(["ru", "kk"]);
    const kk = await storeCatalogPage(ctx, { lang: "kk" });
    expect(kk.items.map((p) => p.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Прописи ${String(191 + i).padStart(4, "0")}`),
    );
    expect(kk.hasMore).toBe(false);
    // Язык не из каталога — без фильтра.
    expect((await storeCatalogPage(ctx, { lang: "uz" })).items).toHaveLength(STORE_PAGE);
  });
});
