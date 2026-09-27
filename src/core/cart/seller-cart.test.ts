import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";

/** Счёт из диалога: корзина покупателю через те же проверки, что у него самого. */
let refuse: Record<string, string> = {};
vi.mock("./cart", () => ({
  addToCart: vi.fn(
    async (ctx: TenantContext, c: Customer, productId: string, variantId: string | null) => {
      if (refuse[productId]) return refuse[productId];
      const rows = ((ctx.db as unknown as FakeDb).tables.cart_items ??= []);
      const row = rows.find(
        (r) => r.product_id === productId && r.product_variant_id === variantId,
      );
      if (row) row.quantity = Number(row.quantity) + 1;
      else
        rows.push({
          bot_id: "b",
          telegram_id: c.telegramId,
          user_key: c.userKey,
          product_id: productId,
          product_variant_id: variantId,
          quantity: 1,
        });
      return "ok";
    },
  ),
  clearCart: vi.fn(async (ctx: TenantContext, c: Customer) => {
    const db = ctx.db as unknown as FakeDb;
    db.tables.cart_items = (db.tables.cart_items ?? []).filter(
      (r) => r.telegram_id !== c.telegramId,
    );
  }),
  listCart: vi.fn(async (ctx: TenantContext, c: Customer) =>
    ((ctx.db as unknown as FakeDb).tables.cart_items ?? [])
      .filter((r) => r.telegram_id === c.telegramId)
      .map((r) => ({
        quantity: r.quantity,
        products: { id: r.product_id, name: String(r.product_id) },
      })),
  ),
  priceCart: vi.fn(
    async (_ctx: unknown, items: Array<{ quantity: number }>, country: string | null) => ({
      lines: items.map((it) => ({ item: it, name: "x", line: 100 * it.quantity })),
      total: items.reduce((s, it) => s + 100 * it.quantity, 0),
      currency: country === "RU" ? "RUB" : "KZT",
      kind: "physical",
    }),
  ),
}));

const { fillCartForCustomer } = await import("./seller-cart");

let db: FakeDb;
const ctx = () => ({ tenant: { id: "b", modules: {} }, db }) as unknown as TenantContext;
const customer = {
  telegramId: 5,
  userKey: "tg:5",
  state: { country_code: "RU" },
} as unknown as Customer;
const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  db = fakeDb();
  refuse = {};
  db.tables.cart_items = [
    {
      bot_id: "b",
      telegram_id: 5,
      user_key: "tg:5",
      product_id: "old",
      product_variant_id: null,
      quantity: 2,
    },
    {
      bot_id: "b",
      telegram_id: 9,
      user_key: "tg:9",
      product_id: "other",
      product_variant_id: null,
      quantity: 1,
    },
  ];
});

describe("счёт из диалога: корзина покупателя", () => {
  it("заменяет прежнюю корзину позициями счёта с количеством, цена — по стране покупателя", async () => {
    const r = await fillCartForCustomer(ctx(), customer, [
      { productId: P1, variantId: null, quantity: 3 },
      { productId: P2, variantId: null, quantity: 1 },
    ]);
    expect(r).toMatchObject({ ok: true, cart: { total: 400, currency: "RUB" } });
    const mine = db.tables.cart_items!.filter((row) => row.telegram_id === 5);
    expect(mine.map((row) => [row.product_id, row.quantity])).toEqual([
      [P1, 3],
      [P2, 1],
    ]);
    expect(db.tables.cart_items!.some((row) => row.telegram_id === 9)).toBe(true);
  });

  it("«добавить к корзине» — то, что покупатель положил сам, остаётся", async () => {
    const r = await fillCartForCustomer(
      ctx(),
      customer,
      [{ productId: P1, variantId: null, quantity: 2 }],
      { append: true },
    );
    expect(r).toMatchObject({ ok: true, cart: { total: 400 } });
    const mine = db.tables.cart_items!.filter((row) => row.telegram_id === 5);
    expect(mine.map((row) => [row.product_id, row.quantity])).toEqual([
      ["old", 2],
      [P1, 2],
    ]);
  });

  it("позиция не прошла проверку — причина, а корзина покупателя остаётся прежней", async () => {
    refuse[P2] = "mixed_cart";
    const r = await fillCartForCustomer(ctx(), customer, [
      { productId: P1, variantId: null, quantity: 1 },
      { productId: P2, variantId: null, quantity: 1 },
    ]);
    expect(r).toEqual({ ok: false, reason: "mixed_cart", productId: P2 });
    const mine = db.tables.cart_items!.filter((row) => row.telegram_id === 5);
    expect(mine.map((row) => [row.product_id, row.quantity])).toEqual([["old", 2]]);
  });

  it("пустой счёт не трогает корзину", async () => {
    expect(await fillCartForCustomer(ctx(), customer, [])).toEqual({ ok: false, reason: "empty" });
    expect(db.tables.cart_items).toHaveLength(2);
  });
});
