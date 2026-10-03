import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeCatalogPage, STORE_PAGE } from "./catalog";
import { parsePriceBound, priceRange } from "./filters";

/**
 * Фильтры главной витрины: «в наличии» и цена от–до. Цена режется в запросе
 * к базе (страницы считаются по отфильтрованному каталогу), «в наличии» —
 * только при включённом модуле «Склад» и только у товаров с нулевым остатком.
 */
const BOT = "00000000-0000-0000-0000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Товар n стоит n·100 ₸; каждый пятый — закончился, каждый седьмой — остаток не ведётся. */
function shop(count: number, modules: Record<string, boolean> = { stock: true }) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.products = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      id: id(n),
      bot_id: BOT,
      name: `Товар ${String(n).padStart(4, "0")}`,
      description: "",
      price: n * 100,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      sort_order: n,
      fulfillment_kind: "physical",
      stock_quantity: n % 7 === 0 ? null : n % 5 === 0 ? 0 : 3,
      category_ids: [],
      rating_count: 0,
      rating_avg: 0,
      created_at: new Date(Date.UTC(2026, 0, 1) + n * 3_600_000).toISOString(),
      product_images: [],
      product_variants: [],
      product_material_files: [],
    };
  });
  db.tables.categories = [];
  return { tenant: { id: BOT, modules, settings: {} }, db } as unknown as TenantContext;
}

async function all(ctx: TenantContext, opts: Parameters<typeof storeCatalogPage>[1]) {
  const out: string[] = [];
  for (let pages = 0; pages < 50; pages++) {
    const r = await storeCatalogPage(ctx, { ...opts, offset: out.length });
    out.push(...r.items.map((p) => p.name));
    if (!r.hasMore) return out;
  }
  throw new Error("страницы не кончились");
}

describe("фильтр цены витрины", () => {
  it("от–до включительно, пагинация по отфильтрованному каталогу", async () => {
    const ctx = shop(459);
    const names = await all(ctx, { minPrice: 10_000, maxPrice: 20_000 });
    // Цены 10 000…20 000 ₸ — товары 100…200.
    expect(names).toHaveLength(101);
    expect(names[0]).toBe("Товар 0100");
    expect(names.at(-1)).toBe("Товар 0200");
    expect(new Set(names).size).toBe(101);
    expect(101).toBeGreaterThan(STORE_PAGE);
  });

  it("«от» больше «до» меняются местами, а не дают пустой список", async () => {
    const ctx = shop(30);
    const swapped = await all(ctx, { minPrice: 1_000, maxPrice: 500 });
    const normal = await all(ctx, { minPrice: 500, maxPrice: 1_000 });
    expect(swapped).toEqual(normal);
    expect(swapped).toHaveLength(6);
  });

  it("только «от» или только «до»", async () => {
    const ctx = shop(30);
    expect(await all(ctx, { minPrice: 2_800 })).toHaveLength(3);
    expect(await all(ctx, { maxPrice: 300 })).toHaveLength(3);
    expect(await all(ctx, {})).toHaveLength(30);
  });
});

describe("фильтр «в наличии» витрины", () => {
  it("прячет товары с нулевым остатком, не ведущиеся на остатке остаются", async () => {
    const ctx = shop(35);
    const names = await all(ctx, { inStock: true });
    // Закончились: 5, 10, 15, 20, 25, 30 (35 и так кратно 7 — остаток не ведётся).
    for (const n of [5, 10, 15, 20, 25, 30])
      expect(names).not.toContain(`Товар ${String(n).padStart(4, "0")}`);
    expect(names).toContain("Товар 0007");
    expect(names).toContain("Товар 0035");
    expect(names).toHaveLength(35 - 6);
  });

  it("без модуля «Склад» остаток ничего не скрывает", async () => {
    const ctx = shop(35, {});
    expect(await all(ctx, { inStock: true })).toHaveLength(35);
  });

  it("сочетается с ценой", async () => {
    const ctx = shop(35);
    const names = await all(ctx, { inStock: true, minPrice: 400, maxPrice: 1_100 });
    // Товары 4…11 без 5 и 10.
    expect(names).toEqual(
      ["4", "6", "7", "8", "9", "11"].map((n) => `Товар ${n.padStart(4, "0")}`),
    );
  });
});

describe("разбор границ цены из адреса", () => {
  it("мусор и отрицательные — не граница", () => {
    expect(parsePriceBound("")).toBeNull();
    expect(parsePriceBound("abc")).toBeNull();
    expect(parsePriceBound("-5")).toBeNull();
    expect(parsePriceBound("1e12")).toBeNull();
    expect(parsePriceBound("1500")).toBe(1500);
    expect(parsePriceBound("12,5")).toBe(12.5);
    expect(priceRange("9", "3")).toEqual({ min: 3, max: 9 });
  });
});
