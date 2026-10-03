import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeCatalogPage, storeInfo } from "./catalog";
import { resetOffersCache, OFFERS_KEY, offerLabel, type OfferState } from "@/core/offers/offers";
import { resetPricingCache, strikePrice } from "@/core/pricing/pricing";

const BOT = "00000000-0000-0000-0000-0000000000b3";
const CAT = "cat-cakes";
const row = (n: number, categories: string[] = []) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  bot_id: BOT,
  name: `Товар ${n}`,
  description: "",
  price: 1000 * n,
  currency: "KZT",
  country_prices: {},
  is_active: true,
  sort_order: n,
  fulfillment_kind: "physical",
  stock_quantity: null,
  category_ids: categories,
  rating_count: 0,
  rating_avg: 0,
  created_at: "2026-01-01T00:00:00Z",
  product_images: [],
  product_variants: [],
  product_material_files: [],
});

function shop(offers: unknown[], modules: Record<string, boolean> = { limited_offers: true }) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.products = [row(1), row(2, [CAT]), row(3)];
  db.tables.categories = [
    { id: CAT, bot_id: BOT, name: "Торты", parent_id: null, is_visible: true },
  ];
  db.tables.app_settings = [{ bot_id: BOT, key: OFFERS_KEY, value: JSON.stringify(offers) }];
  db.tables.order_items = [];
  return {
    tenant: { id: BOT, modules, settings: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}
const on = (over: object) => ({
  id: "s1",
  product_id: "",
  percent: 20,
  starts_at: "2026-10-01T00:00:00Z",
  ends_at: "2026-10-12T18:59:00Z",
  limit: null,
  ...over,
});

beforeEach(() => {
  resetOffersCache();
  resetPricingCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
});

describe("витрина: «Со скидкой»", () => {
  it("остаются товары с идущей акцией — и на сам товар, и на его категорию", async () => {
    const ctx = shop([
      on({ id: "a", product_id: "00000000-0000-4000-8000-000000000001" }),
      on({ id: "b", category_id: CAT }),
    ]);
    const r = await storeCatalogPage(ctx, { sale: true });
    expect(r.items.map((p) => p.name)).toEqual(["Товар 1", "Товар 2"]);
    // У товара с акцией — зачёркнутая прежняя цена и процент для бейджа.
    expect(r.items[1]!.price).toBe(1600);
    expect(r.items[1]!.offer).toMatchObject({ oldPrice: 2000, percent: 20 });
    expect((await storeCatalogPage(ctx, {})).items).toHaveLength(3);
  });

  it("закончившаяся и ещё не начатая акции в фильтр не попадают, фильтра на витрине нет", async () => {
    const ctx = shop([
      on({ category_id: CAT, ends_at: "2026-10-05T09:00:00Z" }),
      on({ id: "z", category_id: CAT, starts_at: "2026-10-06T00:00:00Z" }),
    ]);
    expect((await storeCatalogPage(ctx, { sale: true })).items).toEqual([]);
    expect((await storeInfo(ctx)).saleFilter).toBe(false);
  });

  it("фильтр показывается, пока идёт акция; без модуля — никогда", async () => {
    expect((await storeInfo(shop([on({ category_id: CAT })]))).saleFilter).toBe(true);
    const off = shop([on({ category_id: CAT })], {});
    expect((await storeInfo(off)).saleFilter).toBe(false);
    expect((await storeCatalogPage(off, { sale: true })).items).toEqual([]);
  });
});

describe("карточка бота и Direct: зачёркнутая цена", () => {
  it("прежняя цена есть только при идущей акции и правда ниже новой", async () => {
    const ctx = shop([on({ category_id: CAT })]);
    const withSale = await strikePrice(ctx, row(2, [CAT]), null);
    expect(withSale.price.amount).toBe(1600);
    expect(withSale.old).toBe(2000);
    expect((await strikePrice(ctx, row(1), null)).old).toBeNull();
  });
});

describe("подпись акции на kk и uz", () => {
  const o = {
    id: "s",
    product_id: "p",
    percent: 15,
    starts_at: "2026-10-01T00:00:00Z",
    ends_at: "2026-10-12T18:59:00Z",
    limit: 5,
    sold: 2,
    left: 3,
  } as OfferState;
  it("слова «до» и «осталось» на языке покупателя, дата — по часам магазина", () => {
    const kk = offerLabel(o, "Asia/Almaty", "kk");
    expect(kk).toContain("−15%");
    expect(kk).toContain("дейін");
    expect(kk).toContain("қалды 3");
    expect(kk).toContain("12.10");
    const uz = offerLabel(o, "Asia/Almaty", "uz");
    expect(uz).toContain("gacha");
    expect(uz).toContain("qoldi 3");
  });
});
