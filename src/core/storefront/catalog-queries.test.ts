import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Страница витрины читает базу одинаково много на 5 и на 50 товаров (раньше предзаказ и
 * акция читались по запросу на каждую карточку: 128 запросов на 50 товаров против 15 на 5).
 */
const { resetOffersCache } = await import("@/core/offers/offers");
const { storeProductsByIds, storeCatalog } = await import("./catalog");
const { storeCollection } = await import("./collection-page");

const BOT = "00000000-0000-0000-0000-0000000000aa";
const pid = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;

function shop(n: number) {
  const db = fakeDb();
  db.tables.app_settings = [];
  db.tables.order_items = [];
  db.tables.orders = [];
  db.tables.categories = [];
  db.tables.products = Array.from({ length: n }, (_, i) => ({
    id: pid(i),
    bot_id: BOT,
    name: `Товар ${i}`,
    price: 2000,
    currency: "KZT",
    is_active: true,
    fulfillment_kind: "physical",
    // Половина товаров закончилась: у них читается предзаказ.
    stock_quantity: i % 2 ? 0 : 5,
    rating_count: i % 3 ? 1 : 0,
    rating_avg: 4,
    category_ids: [],
    product_images: [],
    product_material_files: [],
    product_variants: [
      { id: `v${i}a`, name: "S", price: 1000, sort_order: 1 },
      { id: `v${i}b`, name: "M", price: 2000, sort_order: 2 },
    ],
  }));
  const settings = {
    collections: [
      { id: "podborka1", name: "Подборка", product_ids: db.tables.products.map((p) => p.id) },
    ],
  };
  const ctx = {
    tenant: {
      id: BOT,
      modules: { limited_offers: true, stock: true, preorder: true, reviews: true },
      settings,
    },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

async function count(n: number, read: (ctx: TenantContext, ids: string[]) => Promise<unknown>) {
  resetOffersCache();
  const { ctx, db } = shop(n);
  await read(
    ctx,
    db.tables.products!.map((p) => String(p.id)),
  );
  return db.queries;
}

beforeEach(() => resetOffersCache());

describe("витрина: число запросов не растёт с числом товаров", () => {
  it("карточки по списку id: 5 и 50 товаров — столько же запросов", async () => {
    const read = (ctx: TenantContext, ids: string[]) => storeProductsByIds(ctx, ids);
    const few = await count(5, read);
    expect(few).toBeGreaterThan(0);
    expect(await count(50, read)).toBe(few);
  });

  it("каталог: 5 и 50 товаров — столько же запросов", async () => {
    const read = (ctx: TenantContext) => storeCatalog(ctx, {});
    const few = await count(5, read);
    expect(await count(50, read)).toBe(few);
  });

  it("страница подборки: 5 и 50 товаров — столько же запросов", async () => {
    const read = async (ctx: TenantContext) => {
      const page = await storeCollection(ctx, "podborka1");
      expect(page?.items.length).toBeGreaterThan(0);
    };
    const few = await count(5, read);
    expect(await count(50, read)).toBe(few);
  });

  it("предзаказ у закончившегося товара по-прежнему приходит из настроек", async () => {
    resetOffersCache();
    const { ctx, db } = shop(4);
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: `preorder:${pid(1)}`,
      value: "2999-01-01",
    });
    const list = (await storeProductsByIds(
      ctx,
      db.tables.products!.map((p) => String(p.id)),
    )) as Array<{ id: string; preorder: { from: string | null } | null }>;
    expect(list.find((p) => p.id === pid(1))?.preorder).toEqual({ from: "2999-01-01" });
    expect(list.find((p) => p.id === pid(3))?.preorder).toBeNull();
  });
});
