import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

// Цена строки — из resolvePrice; здесь валюта товара приходит как есть.
vi.mock("@/core/pricing/pricing", () => ({
  resolvePrice: async (_ctx: unknown, p: { price: number; currency: string }) => ({
    amount: p.price,
    currency: p.currency,
  }),
}));
const { priceCart } = await import("./cart");

const ctx = { tenant: { id: "b", modules: {}, settings: {} } } as unknown as TenantContext;
const item = (id: string, price: number, currency: string) =>
  ({
    id,
    quantity: 1,
    product_variants: null,
    products: { id, name: id, price, currency, fulfillment_kind: "physical" },
  }) as never;

describe("корзина в разных валютах", () => {
  it("$50 и 2000 ₸ не складываются в 2050 ₸ — корзина помечена", async () => {
    const r = await priceCart(ctx, [item("a", 50, "USD"), item("b", 2000, "KZT")], null);
    expect(r.mixedCurrency).toBe(true);
  });

  it("одна валюта (регистр не важен) — обычная сумма", async () => {
    const r = await priceCart(ctx, [item("a", 1000, "KZT"), item("b", 2000, "kzt")], null);
    expect(r).toMatchObject({ mixedCurrency: false, total: 3000 });
  });
});
