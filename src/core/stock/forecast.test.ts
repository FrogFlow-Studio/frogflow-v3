import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { daysLeft, forecastFor, runningOut, runningOutNow, soldByProduct } from "./forecast";

const BOT = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-10-04T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

function setup() {
  const db = fakeDb();
  db.tables.products = [
    {
      id: P1,
      bot_id: BOT,
      name: "Мука",
      is_active: true,
      fulfillment_kind: "physical",
      stock_quantity: 10,
    },
    {
      id: P2,
      bot_id: BOT,
      name: "Сахар",
      is_active: true,
      fulfillment_kind: "physical",
      stock_quantity: 100,
    },
    {
      id: P3,
      bot_id: BOT,
      name: "Соль",
      is_active: true,
      fulfillment_kind: "physical",
      stock_quantity: 5,
    },
    {
      id: "4",
      bot_id: BOT,
      name: "Файл",
      is_active: true,
      fulfillment_kind: "digital",
      stock_quantity: null,
    },
  ];
  db.tables.orders = [
    { id: 1, bot_id: BOT, created_at: day(2), status: "delivered", fulfillment_kind: "physical" },
    { id: 2, bot_id: BOT, created_at: day(3), status: "cancelled", fulfillment_kind: "physical" },
    { id: 3, bot_id: BOT, created_at: day(40), status: "delivered", fulfillment_kind: "physical" },
    { id: 4, bot_id: BOT, created_at: day(1), status: "new", fulfillment_kind: "physical" },
  ];
  db.tables.order_items = [
    { id: "a", order_id: 1, product_id: P1, product_variant_id: "v1", quantity: 30 },
    { id: "b", order_id: 1, product_id: P1, product_variant_id: "v2", quantity: 30 },
    { id: "c", order_id: 2, product_id: P1, product_variant_id: null, quantity: 500 },
    { id: "d", order_id: 3, product_id: P2, product_variant_id: null, quantity: 500 },
    { id: "e", order_id: 4, product_id: P2, product_variant_id: null, quantity: 500 },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { stock: true } },
    db,
  } as unknown as TenantContext;
  return { ctx };
}

describe("прогноз «хватит на N дней»", () => {
  it("нет продаж — «—», не деление на ноль; остаток не ведётся — тоже", () => {
    expect(daysLeft(10, 0)).toBeNull();
    expect(daysLeft(null, 10)).toBeNull();
    expect(daysLeft(0, 10)).toBe(0);
  });

  it("остаток / средние продажи в день, вниз", () => {
    // 60 за 30 дней = 2 в день; остаток 10 → 5 дней
    expect(daysLeft(10, 60)).toBe(5);
    expect(daysLeft(11, 60)).toBe(5);
    expect(daysLeft(100, 30)).toBe(100);
  });

  it("считаются только засчитанные заказы за 30 дней; варианты суммируются на товар", async () => {
    const { ctx } = setup();
    const sold = await soldByProduct(ctx, NOW);
    // отменённый, старый (40 дней) и неоплаченный новый не считаются
    expect(sold.get(P1)).toBe(60);
    expect(sold.get(P2)).toBeUndefined();
  });

  it("список товаров: дни только у тех, у кого есть продажи", async () => {
    const { ctx } = setup();
    const map = await forecastFor(
      ctx,
      [
        { id: P1, name: "Мука", stock: 10 },
        { id: P2, name: "Сахар", stock: 100 },
      ],
      NOW,
    );
    expect(map).toEqual({ [P1]: 5 });
  });

  it("меньше недели — в сводку, самые срочные первыми; нет продаж — не попадает", async () => {
    expect(
      runningOut(
        [
          { id: "b", name: "B", stock: 10 },
          { id: "a", name: "A", stock: 5 },
          { id: "c", name: "C", stock: 1000 },
          { id: "d", name: "D", stock: 1 },
        ],
        new Map([
          ["a", 60],
          ["b", 60],
          ["c", 60],
        ]),
      ).map((r) => [r.id, r.days]),
    ).toEqual([
      ["a", 2],
      ["b", 5],
    ]);
    const { ctx } = setup();
    expect((await runningOutNow(ctx, NOW)).map((r) => r.id)).toEqual([P1]);
  });

  it("без модуля «Склад» — пусто, в базу не ходим", async () => {
    const { ctx } = setup();
    (ctx.tenant as { modules: Record<string, boolean> }).modules = {};
    expect(await runningOutNow(ctx, NOW)).toEqual([]);
    expect(await forecastFor(ctx, [{ id: P1, name: "Мука", stock: 10 }], NOW)).toEqual({});
  });
});
