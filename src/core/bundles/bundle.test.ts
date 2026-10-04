import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { resetPricingCache } from "@/core/pricing/pricing";
import { resetOffersCache, OFFERS_KEY } from "@/core/offers/offers";
import { isUserError } from "@/core/i18n/user-error";
import {
  bundleSaving,
  bundleView,
  copyBundle,
  dropBundle,
  listBundles,
  loadBundle,
  mergeItems,
  parseBundle,
  saveBundle,
  type BundleItem,
} from "./bundle";

const BOT = "00000000-0000-0000-0000-0000000000a1";
const SET = "b0000000-0000-4000-8000-000000000001"; // набор
const SHAMPOO = "b0000000-0000-4000-8000-000000000002";
const BALM = "b0000000-0000-4000-8000-000000000003";
const SET2 = "b0000000-0000-4000-8000-000000000004";
const FILE = "b0000000-0000-4000-8000-000000000005"; // цифровой
const BALM_V = "c0000000-0000-4000-8000-000000000001";
const BALM_V2 = "c0000000-0000-4000-8000-000000000002";

function setup(opts: { offers?: unknown[] } = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  const prod = (id: string, name: string, price: number, extra = {}) => ({
    id,
    bot_id: BOT,
    name,
    price,
    currency: "KZT",
    country_prices: [],
    category_ids: [],
    is_active: true,
    fulfillment_kind: "physical",
    ...extra,
  });
  db.tables.products = [
    prod(SET, "Набор уход", 3000),
    prod(SHAMPOO, "Шампунь", 2000),
    prod(BALM, "Бальзам", 1500),
    prod(SET2, "Другой набор", 1000),
    prod(FILE, "Гайд", 500, { fulfillment_kind: "digital" }),
  ];
  db.tables.product_variants = [
    { id: BALM_V, bot_id: BOT, product_id: BALM, name: "250 мл", price: 1500, sort_order: 0 },
    { id: BALM_V2, bot_id: BOT, product_id: BALM, name: "500 мл", price: 2500, sort_order: 1 },
  ];
  db.tables.app_settings = opts.offers
    ? [{ bot_id: BOT, key: OFFERS_KEY, value: JSON.stringify(opts.offers) }]
    : [];
  db.tables.order_items = [];
  db.tables.payment_methods = [];
  const ctx = {
    tenant: {
      id: BOT,
      modules: { bundles: true, limited_offers: Boolean(opts.offers) },
      settings: {},
    },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const item = (productId: string, qty = 1, variantId: string | null = null): BundleItem => ({
  productId,
  variantId,
  qty,
});
const stored = (db: ReturnType<typeof setup>["db"], id: string) =>
  db.tables.app_settings!.find((r) => r.key === `bundle:${id}`)?.value;

beforeEach(() => {
  resetOffersCache();
  resetPricingCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("набор товаров — запись состава", () => {
  it("состав сохраняется и читается обратно", async () => {
    const { ctx, db } = setup();
    await saveBundle(ctx, SET, [item(SHAMPOO, 2), item(BALM, 1, BALM_V)]);
    expect(await loadBundle(ctx, SET)).toEqual([item(SHAMPOO, 2), item(BALM, 1, BALM_V)]);
    expect(String(stored(db, SET))).toContain(SHAMPOO);
    expect((await listBundles(ctx)).get(SET)).toHaveLength(2);
  });

  it("повтор «товар + вариант» складывает штуки", async () => {
    const { ctx } = setup();
    await saveBundle(ctx, SET, [item(SHAMPOO, 1), item(SHAMPOO, 2)]);
    expect(await loadBundle(ctx, SET)).toEqual([item(SHAMPOO, 3)]);
  });

  it("пустой состав снимает набор", async () => {
    const { ctx } = setup();
    await saveBundle(ctx, SET, [item(SHAMPOO)]);
    expect(await saveBundle(ctx, SET, null)).toBeNull();
    expect(await loadBundle(ctx, SET)).toBeNull();
  });

  it("набор в наборе — отказ: компонент сам набор", async () => {
    const { ctx } = setup();
    await saveBundle(ctx, SET2, [item(SHAMPOO)]);
    const err = await saveBundle(ctx, SET, [item(SET2)]).catch((e) => e);
    expect(isUserError(err) && err.key).toBe("err.bundle.nested");
    expect(await loadBundle(ctx, SET)).toBeNull();
  });

  it("набор в наборе — отказ: этот товар уже чей-то компонент", async () => {
    const { ctx } = setup();
    await saveBundle(ctx, SET, [item(SHAMPOO)]);
    const err = await saveBundle(ctx, SHAMPOO, [item(BALM, 1, BALM_V)]).catch((e) => e);
    expect(isUserError(err) && err.key).toBe("err.bundle.nestedIn");
  });

  it("набор не включает сам себя", async () => {
    const { ctx } = setup();
    const err = await saveBundle(ctx, SET, [item(SET)]).catch((e) => e);
    expect(isUserError(err) && err.key).toBe("err.bundle.nested");
  });

  it("цифровой товар в составе и цифровой набор — отказ", async () => {
    const { ctx } = setup();
    const a = await saveBundle(ctx, SET, [item(FILE)]).catch((e) => e);
    expect(isUserError(a) && a.key).toBe("err.bundle.componentNotPhysical");
    const b = await saveBundle(ctx, FILE, [item(SHAMPOO)]).catch((e) => e);
    expect(isUserError(b) && b.key).toBe("err.bundle.notPhysical");
  });

  it("у товара с вариантами вариант обязателен и должен быть его", async () => {
    const { ctx } = setup();
    const a = await saveBundle(ctx, SET, [item(BALM)]).catch((e) => e);
    expect(isUserError(a) && a.key).toBe("err.bundle.variantRequired");
    const b = await saveBundle(ctx, SET, [item(SHAMPOO, 1, BALM_V)]).catch((e) => e);
    expect(isUserError(b) && b.key).toBe("err.bundle.noVariant");
  });

  it("количество — целое от 1 до 99", async () => {
    const { ctx } = setup();
    for (const q of [0, 100, 1.5]) {
      const e = await saveBundle(ctx, SET, [item(SHAMPOO, q)]).catch((x) => x);
      expect(isUserError(e) && e.key).toBe("err.bundle.badQty");
    }
  });

  it("мусорная запись читается как «не набор»", () => {
    expect(parseBundle("{")).toBeNull();
    expect(parseBundle('{"items":[{"p":"x","q":1}]}')).toBeNull();
    expect(parseBundle("")).toBeNull();
    expect(mergeItems([item(SHAMPOO), item(SHAMPOO)])).toEqual([item(SHAMPOO, 2)]);
  });

  it("копия и удаление товара переносят и убирают состав", async () => {
    const { ctx, db } = setup();
    await saveBundle(ctx, SET, [item(SHAMPOO, 2)]);
    await copyBundle(ctx, SET, SET2);
    expect(await loadBundle(ctx, SET2)).toEqual([item(SHAMPOO, 2)]);
    await dropBundle(ctx, SET2);
    expect(stored(db, SET2)).toBeUndefined();
  });
});

describe("набор товаров — выгода и доступность", () => {
  it("выгода — цена по отдельности минус цена набора", async () => {
    const { ctx } = setup();
    await saveBundle(ctx, SET, [item(SHAMPOO, 1), item(BALM, 2, BALM_V)]);
    const v = await bundleView(ctx, SET);
    expect(v).toMatchObject({
      available: true,
      separateTotal: 2000 + 2 * 1500,
      saving: 5000 - 3000,
      bundlePrice: 3000,
    });
  });

  it("выгода считается по текущим ценам: акция на компонент уменьшает её", async () => {
    const offers = [
      {
        id: "o1",
        product_id: SHAMPOO,
        percent: 50,
        starts_at: "2026-10-01T00:00:00Z",
        ends_at: "2026-10-12T18:59:00Z",
        limit: null,
      },
    ];
    const { ctx } = setup({ offers });
    await saveBundle(ctx, SET, [item(SHAMPOO), item(BALM, 1, BALM_V)]);
    const v = await bundleView(ctx, SET);
    // шампунь 2000 → 1000 по акции: 1000 + 1500 = 2500, набор 3000 — дороже.
    expect(v).toMatchObject({ separateTotal: 2500, saving: -500 });
  });

  it("скрытый компонент делает набор недоступным с пометкой", async () => {
    const { ctx, db } = setup();
    await saveBundle(ctx, SET, [item(SHAMPOO), item(BALM, 1, BALM_V)]);
    db.tables.products!.find((p) => p.id === SHAMPOO)!.is_active = false;
    const v = await bundleView(ctx, SET);
    expect(v!.available).toBe(false);
    expect(v!.items.find((i) => i.productId === SHAMPOO)).toMatchObject({ state: "hidden" });
    expect(v!.saving).toBeNull();
  });

  it("удалённый компонент и удалённый вариант — тоже недоступен", async () => {
    const { ctx, db } = setup();
    await saveBundle(ctx, SET, [item(SHAMPOO), item(BALM, 1, BALM_V)]);
    db.tables.products = db.tables.products!.filter((p) => p.id !== SHAMPOO);
    expect((await bundleView(ctx, SET))!.items[0]).toMatchObject({ state: "deleted", name: null });
    db.tables.product_variants = db.tables.product_variants!.filter((v) => v.id !== BALM_V);
    const v = await bundleView(ctx, SET);
    expect(v!.items[1]).toMatchObject({ state: "noVariant" });
    expect(v!.available).toBe(false);
  });

  it("не набор — null", async () => {
    const { ctx } = setup();
    expect(await bundleView(ctx, SET)).toBeNull();
  });

  it("чистая арифметика: нет цены у части — выгоду не считаем", () => {
    expect(bundleSaving(100, [{ unitPrice: 60, qty: 2 }])).toEqual({
      separateTotal: 120,
      saving: 20,
    });
    expect(bundleSaving(100, [{ unitPrice: null, qty: 1 }])).toBeNull();
    expect(bundleSaving(100, [])).toBeNull();
  });
});
