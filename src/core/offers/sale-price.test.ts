import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { resolvePrice, resetPricingCache } from "@/core/pricing/pricing";
import { priceCart, type CartItem } from "@/core/cart/cart";
import { applyOfferTo, percentForNewPrice, resetOffersCache, OFFERS_KEY } from "./offers";

const BOT = "00000000-0000-0000-0000-0000000000a1";
const cake = { id: "p1", name: "Торт", price: 10000, currency: "KZT", category_ids: ["cat-cakes"] };

function setup(offers: unknown[]) {
  const db = fakeDb();
  db.tables.app_settings = [{ bot_id: BOT, key: OFFERS_KEY, value: JSON.stringify(offers) }];
  db.tables.order_items = [];
  db.tables.payment_methods = [];
  const ctx = {
    tenant: { id: BOT, modules: { limited_offers: true } },
    db,
  } as unknown as TenantContext;
  return ctx;
}

const base = {
  starts_at: "2026-10-01T00:00:00Z",
  ends_at: "2026-10-12T18:59:00Z",
  limit: null,
};

beforeEach(() => {
  resetOffersCache();
  resetPricingCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("цена по акции со сроком", () => {
  it("акция на категорию действует на товар этой категории и не трогает чужие", async () => {
    const ctx = setup([
      { ...base, id: "s1", product_id: "", category_id: "cat-cakes", percent: 20 },
    ]);
    expect(await resolvePrice(ctx, cake, null)).toEqual({ amount: 8000, currency: "KZT" });
    expect(await resolvePrice(ctx, { ...cake, category_ids: ["other"] }, null)).toEqual({
      amount: 10000,
      currency: "KZT",
    });
    // Строка без категорий (например, неполная выборка) цену не ломает.
    expect(await resolvePrice(ctx, { id: "p1", price: 10000 }, null)).toEqual({
      amount: 10000,
      currency: "KZT",
    });
  });

  it("акция с новой ценой: цена товара — новая, у варианта — та же доля", async () => {
    const ctx = setup([
      {
        ...base,
        id: "s2",
        product_id: "p1",
        new_price: 7500,
        percent: percentForNewPrice(7500, 10000),
      },
    ]);
    expect(await resolvePrice(ctx, cake, null)).toEqual({ amount: 7500, currency: "KZT" });
    expect(await resolvePrice(ctx, cake, null, { price: 12000 })).toEqual({
      amount: 9000,
      currency: "KZT",
    });
  });

  it("из товарной и категорийной акций берётся щедрее", async () => {
    const ctx = setup([
      { ...base, id: "a", product_id: "", category_id: "cat-cakes", percent: 10 },
      { ...base, id: "b", product_id: "p1", percent: 30 },
    ]);
    expect((await resolvePrice(ctx, cake, null)).amount).toBe(7000);
  });

  it("граница срока: за секунду до конца цена со скидкой, в момент конца — прежняя", async () => {
    const ctx = setup([{ ...base, id: "s1", product_id: "p1", percent: 50 }]);
    vi.setSystemTime(new Date("2026-10-12T18:58:59Z"));
    expect((await resolvePrice(ctx, cake, null)).amount).toBe(5000);
    resetOffersCache();
    vi.setSystemTime(new Date("2026-10-12T18:59:00Z"));
    expect((await resolvePrice(ctx, cake, null)).amount).toBe(10000);
  });

  it("корзина считается по акции на момент оформления: кончилась — цена прежняя", async () => {
    const ctx = setup([{ ...base, id: "s1", product_id: "p1", percent: 20 }]);
    const item = {
      id: "i1",
      quantity: 2,
      product_variant_id: null,
      products: { ...cake, fulfillment_kind: "physical", product_material_files: [] },
      product_variants: null,
    } as unknown as CartItem;
    vi.setSystemTime(new Date("2026-10-12T18:00:00Z"));
    expect((await priceCart(ctx, [item], null)).total).toBe(16000);
    // Покупатель думал дольше срока акции: новая сумма видна до оплаты.
    resetOffersCache();
    vi.setSystemTime(new Date("2026-10-12T19:30:00Z"));
    expect((await priceCart(ctx, [item], null)).total).toBe(20000);
  });
});

describe("расчёт цены", () => {
  it("новая цена не выше основной и процент для бейджа", () => {
    expect(applyOfferTo(1000, { percent: 25, new_price: 750 }, 1000)).toBe(750);
    expect(applyOfferTo(1000, { percent: 10 }, 1000)).toBe(900);
    expect(percentForNewPrice(750, 1000)).toBe(25);
    expect(percentForNewPrice(1000, 1000)).toBe(0);
    expect(percentForNewPrice(0, 1000)).toBe(99);
  });
});

describe("сбой чтения акций", () => {
  it("не превращается в «акций нет»: цена не отдаётся по обычной, а ошибка не кешируется", async () => {
    const ctx = setup([{ ...base, id: "s1", product_id: "p1", percent: 20 }]);
    const real = ctx.db.from.bind(ctx.db);
    let broken = true;
    (ctx.db as unknown as { from: unknown }).from = (t: string) =>
      broken && t === "app_settings"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
              }),
            }),
          }
        : real(t as never);
    await expect(resolvePrice(ctx, cake, null)).rejects.toThrow();
    broken = false;
    expect((await resolvePrice(ctx, cake, null)).amount).toBe(8000);
  });
});
