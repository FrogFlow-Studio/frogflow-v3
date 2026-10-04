import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { resetOffersCache } from "@/core/offers/offers";
import { resetPricingCache } from "@/core/pricing/pricing";
import { storeCatalogPage, storeInfo, storeProduct } from "./catalog";
import { productJsonLd } from "./seo";

const BOT = "00000000-0000-0000-0000-0000000000b4";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SET = id(1);
const SHAMPOO = id(2);
const BALM = id(3);
const row = (n: number, name: string, price: number, extra: object = {}) => ({
  id: id(n),
  bot_id: BOT,
  name,
  description: "",
  price,
  currency: "KZT",
  country_prices: {},
  is_active: true,
  sort_order: n,
  fulfillment_kind: "physical",
  stock_quantity: null,
  category_ids: [],
  rating_count: 0,
  rating_avg: 0,
  created_at: "2026-01-01T00:00:00Z",
  product_images: [],
  product_variants: [],
  product_material_files: [],
  ...extra,
});

function shop(
  opts: { modules?: Record<string, boolean>; balmActive?: boolean; balmStock?: number | null } = {},
) {
  const db = fakeDb({ maxRows: 1000, unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [
    row(1, "Набор уход", 3000),
    row(2, "Шампунь", 2000),
    row(3, "Бальзам", 1500, {
      is_active: opts.balmActive ?? true,
      stock_quantity: opts.balmStock ?? null,
    }),
  ];
  db.tables.categories = [];
  db.tables.product_variants = [];
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: `bundle:${SET}`,
      value: JSON.stringify({
        items: [
          { p: SHAMPOO, q: 2 },
          { p: BALM, q: 1 },
        ],
      }),
    },
  ];
  db.tables.order_items = [];
  db.tables.payment_methods = [];
  return {
    tenant: { id: BOT, modules: opts.modules ?? { bundles: true }, settings: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

beforeEach(() => {
  resetOffersCache();
  resetPricingCache();
});

describe("витрина: наборы", () => {
  it("карточка набора: состав, цена набора и выгода по отдельности", async () => {
    const r = await storeCatalogPage(shop());
    const set = r.items.find((p) => p.id === SET)!;
    expect(set.price).toBe(3000);
    expect(set.bundle).toEqual({
      parts: [
        { name: "Шампунь", variantName: null, qty: 2 },
        { name: "Бальзам", variantName: null, qty: 1 },
      ],
      saving: 2500, // 2×2000 + 1500 − 3000
      separateTotal: 5500,
      available: true,
      capacity: null,
    });
    expect(set.inStock).toBe(true);
    expect(r.items.find((p) => p.id === SHAMPOO)!.bundle).toBeNull();
  });

  it("фильтр «Наборы» оставляет только наборы, без него каталог целый", async () => {
    const ctx = shop();
    expect((await storeCatalogPage(ctx, { bundles: true })).items.map((p) => p.name)).toEqual([
      "Набор уход",
    ]);
    expect((await storeCatalogPage(ctx)).items).toHaveLength(3);
  });

  it("модуль выключен: наборов нет ни в карточках, ни в фильтре", async () => {
    const ctx = shop({ modules: {} });
    const r = await storeCatalogPage(ctx, { bundles: true });
    expect(r.items).toEqual([]);
    expect((await storeCatalogPage(ctx)).items.every((p) => p.bundle === null)).toBe(true);
    expect((await storeInfo(ctx)).bundleFilter).toBe(false);
  });

  it("фильтр «Наборы» в витрине виден, когда набор заведён", async () => {
    expect((await storeInfo(shop())).bundleFilter).toBe(true);
  });

  it("скрытая составляющая: набор недоступен, предзаказа и «в наличии» нет", async () => {
    const r = await storeCatalogPage(shop({ balmActive: false }));
    const set = r.items.find((p) => p.id === SET)!;
    expect(set.bundle?.available).toBe(false);
    expect(set.inStock).toBe(false);
    expect(set.preorder).toBeNull();
    expect(
      (await storeCatalogPage(shop({ balmActive: false }), { inStock: true })).items,
    ).not.toContainEqual(expect.objectContaining({ id: SET }));
  });

  it("остаток набора — по составляющим: бальзама нет — набор не в наличии, без предзаказа", async () => {
    const ctx = shop({ modules: { bundles: true, stock: true }, balmStock: 0 });
    const set = (await storeCatalogPage(ctx)).items.find((p) => p.id === SET)!;
    expect(set.inStock).toBe(false);
    expect(set.preorder).toBeNull();
    expect((await storeCatalogPage(ctx, { inStock: true })).items.map((p) => p.id)).toEqual([
      SHAMPOO,
    ]);
    const some = shop({ modules: { bundles: true, stock: true }, balmStock: 3 });
    expect((await storeCatalogPage(some)).items.find((p) => p.id === SET)!.inStock).toBe(true);
  });

  it("страница набора и разметка Product с ценой набора и составом", async () => {
    const ctx = shop();
    const p = (await storeProduct(ctx, SET))!;
    expect(p.bundle?.parts).toHaveLength(2);
    const ld = productJsonLd(
      p,
      { name: "Магазин", slug: "shop", origin: "https://x.test" },
      null,
    ) as {
      offers: { price: string; availability: string };
      additionalProperty: { value: string };
    };
    expect(ld.offers.price).toBe("3000");
    expect(ld.offers.availability).toBe("https://schema.org/InStock");
    expect(ld.additionalProperty.value).toBe("Шампунь × 2, Бальзам × 1");
    const none = productJsonLd(
      (await storeProduct(ctx, SHAMPOO))!,
      { name: "Магазин", slug: "shop", origin: "https://x.test" },
      null,
    );
    expect(none).not.toHaveProperty("additionalProperty");
  });
});
