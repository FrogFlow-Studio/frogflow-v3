import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { confirmedPurchases } from "./recent.server";

let db: FakeDb;
const ctx = () =>
  ({
    tenant: { id: "b1", name: "Лавка", vertical: "shop", modules: {}, settings: {} },
    db,
  }) as unknown as TenantContext;

beforeEach(() => {
  db = fakeDb();
  db.tables.orders = [
    { id: 1, bot_id: "b1", telegram_id: 10, status: "delivered" },
    { id: 2, bot_id: "b1", telegram_id: 11, status: "cancelled" },
    { id: 3, bot_id: "b1", telegram_id: 12, status: "awaiting_payment" },
    { id: 4, bot_id: "other", telegram_id: 13, status: "delivered" },
  ];
  db.tables.order_items = [
    { order_id: 1, product_id: "p1" },
    { order_id: 2, product_id: "p1" },
    { order_id: 3, product_id: "p1" },
    { order_id: 4, product_id: "p1" },
  ];
});

describe("покупка подтверждена (П3)", () => {
  it("только выданный заказ с этим товаром даёт пометку", async () => {
    const got = await confirmedPurchases(ctx(), [
      { telegramId: 10, productId: "p1" },
      { telegramId: 11, productId: "p1" },
      { telegramId: 12, productId: "p1" },
      { telegramId: 10, productId: "p2" },
    ]);
    expect([...got]).toEqual(["10:p1"]);
  });

  it("автор без заказов (например, только почта сайта) пометки не получает", async () => {
    const got = await confirmedPurchases(ctx(), [{ telegramId: 99, productId: "p1" }]);
    expect(got.size).toBe(0);
  });

  it("выданный заказ того же покупателя в чужом магазине пометки не даёт", async () => {
    const got = await confirmedPurchases(ctx(), [{ telegramId: 13, productId: "p1" }]);
    expect(got.size).toBe(0);
  });

  it("больше 200 товаров не обрезаются молча", async () => {
    db.tables.order_items!.push({ order_id: 1, product_id: "p250" });
    const pairs = Array.from({ length: 300 }, (_, i) => ({ telegramId: 10, productId: `p${i}` }));
    const got = await confirmedPurchases(ctx(), pairs);
    expect(got.has("10:p250")).toBe(true);
  });
});
