import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { buildStale, staleReport } from "./stale";

const BOT = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-10-04T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const P = (n: number) => `${n}`.repeat(8) + "-1111-4111-8111-" + `${n}`.repeat(12);

function setup() {
  const db = fakeDb();
  const prod = (n: number, over: Record<string, unknown> = {}) => ({
    id: P(n),
    bot_id: BOT,
    name: `Товар ${n}`,
    is_active: true,
    fulfillment_kind: "physical",
    stock_quantity: 10,
    created_at: day(200),
    ...over,
  });
  db.tables.products = [
    prod(1), // не продавался — залежался
    prod(2), // продан 59 дней назад — не залежался
    prod(3), // продан 61 день назад — залежался
    prod(4), // продан только в отменённом — залежался
    prod(5, { stock_quantity: 0 }), // нет остатка
    prod(6, { created_at: day(10) }), // новый, ещё не залежался
    prod(7, { is_active: false }), // скрытый
    prod(8, { fulfillment_kind: "digital", stock_quantity: null }),
  ];
  db.tables.orders = [
    { id: 1, bot_id: BOT, created_at: day(59), status: "delivered", fulfillment_kind: "physical" },
    { id: 2, bot_id: BOT, created_at: day(61), status: "delivered", fulfillment_kind: "physical" },
    { id: 3, bot_id: BOT, created_at: day(5), status: "cancelled", fulfillment_kind: "physical" },
  ];
  db.tables.order_items = [
    { id: "a", order_id: 1, product_id: P(2), quantity: 1 },
    { id: "b", order_id: 2, product_id: P(3), quantity: 1 },
    { id: "c", order_id: 3, product_id: P(4), quantity: 1 },
  ];
  db.tables.app_settings = [
    { bot_id: BOT, key: `cost:${P(1)}`, value: JSON.stringify({ p: 100, v: {}, cur: "KZT" }) },
    { bot_id: BOT, key: `cost:${P(3)}`, value: JSON.stringify({ p: 50, v: {}, cur: "KZT" }) },
  ];
  const ctx = { tenant: { id: BOT, modules: { stock: true } }, db } as unknown as TenantContext;
  return { ctx };
}

describe("залежавшийся товар", () => {
  it("отбор: продажа 59 дней назад — не залежался, 61 — залежался, отменённая не в счёт", async () => {
    const { ctx } = setup();
    const r = await staleReport(ctx, 60, NOW);
    expect(r.products.map((p) => p.id).sort()).toEqual([P(1), P(3), P(4)].sort());
  });

  it("«заморожено» по себестоимости; без себестоимости — отдельно, в сумму не входит", async () => {
    const { ctx } = setup();
    const r = await staleReport(ctx, 60, NOW);
    expect(r.products.map((p) => [p.id, p.frozen])).toEqual([
      [P(1), 1000],
      [P(3), 500],
      [P(4), null],
    ]);
    expect(r.frozenTotal).toBe(1500);
    expect(r.unknownCost).toBe(1);
    expect(r.currency).toBe("KZT");
  });

  it("свой порог дней; граница нижняя и верхняя ограничены", async () => {
    const { ctx } = setup();
    // За 30 дней продажа 59 дней назад уже не считается — товар залежался.
    expect((await staleReport(ctx, 30, NOW)).products.map((p) => p.id)).toContain(P(2));
    // За 90 дней продажа 61 день назад считается — товар не залежался.
    expect((await staleReport(ctx, 90, NOW)).products.map((p) => p.id)).not.toContain(P(3));
    expect((await staleReport(ctx, 1, NOW)).days).toBe(7);
    expect((await staleReport(ctx, 99999, NOW)).days).toBe(365);
  });

  it("себестоимость в другой валюте не умножается на остаток", () => {
    const r = buildStale({
      days: 60,
      now: NOW,
      currency: "KZT",
      candidates: [{ id: "x", name: "X", stock_quantity: 3, created_at: day(100) }],
      soldIds: new Set(),
      costs: new Map([["x", { price: 10, variants: {}, currency: "USD" }]]),
    });
    expect(r.products[0]).toMatchObject({ frozen: null, unitCost: null });
    expect(r.frozenTotal).toBe(0);
  });
});
