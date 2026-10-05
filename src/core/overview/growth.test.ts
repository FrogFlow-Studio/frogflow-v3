import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { growthOrders, trio, type GrowthOrder } from "./growth";
import { loadGrowth } from "./growth.server";

const now = new Date("2026-10-05T10:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const order = (
  id: number,
  daysAgo: number,
  total: number,
  over: Partial<GrowthOrder> = {},
): GrowthOrder => ({
  id,
  created_at: ago(daysAgo),
  total,
  paid_amount: 0,
  currency: "KZT",
  status: "delivered",
  fulfillment_kind: "digital",
  ...over,
});

describe("блок «Рост» (У5)", () => {
  it("изменение в процентах; не с чем сравнить — null, а не бесконечность", () => {
    expect(trio(150, 100).deltaPct).toBe(50);
    expect(trio(50, 100).deltaPct).toBe(-50);
    expect(trio(10, 0).deltaPct).toBeNull();
    expect(trio(0, 0).deltaPct).toBeNull();
  });

  it("выручка и заказы: текущие 30 суток против прежних, возвраты вычитаются, неоплаченные не считаются", () => {
    const r = growthOrders(
      [
        order(1, 2, 3000),
        order(2, 10, 1000),
        order(3, 40, 2000), // прежний период
        order(4, 5, 7000, { status: "awaiting_payment" }), // не оплачен
        order(5, 3, 999, { currency: "USD" }), // другая валюта
      ],
      new Map([[1, 500]]),
      now,
    );
    expect(r.currency).toBe("KZT");
    expect(r.revenue).toEqual({ cur: 3500, prev: 2000, deltaPct: 75 });
    expect(r.orders).toEqual({ cur: 2, prev: 1, deltaPct: 100 });
  });

  it("заказов нет — нули и null, без падения", () => {
    const r = growthOrders([], new Map(), now);
    expect(r.revenue).toEqual({ cur: 0, prev: 0, deltaPct: null });
    expect(r.orders.deltaPct).toBeNull();
  });

  describe("чтение", () => {
    const BOT = "11111111-1111-1111-1111-111111111111";
    function setup(orders = 1100) {
      const db = fakeDb({ maxRows: 1000 });
      db.tables.orders = Array.from({ length: orders }, (_, i) => ({
        ...order(i + 1, 1 + (i % 20), 100),
        bot_id: BOT,
      }));
      db.tables.zernio_logs = [];
      db.tables.bot_users = [
        { user_key: "tg_1", bot_id: BOT, created_at: ago(3) },
        { user_key: "tg_2", bot_id: BOT, created_at: ago(5) },
        { user_key: "tg_3", bot_id: BOT, created_at: ago(40) },
      ];
      const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;
      return { ctx, db };
    }

    it("больше тысячи заказов не обрезаются; новые покупатели считаются по окнам", async () => {
      const { ctx } = setup();
      const g = await loadGrowth(ctx, now);
      expect(g.orders.cur).toBe(1100);
      expect(g.revenue.cur).toBe(110_000);
      expect(g.buyers).toEqual({ cur: 2, prev: 1, deltaPct: 100 });
    });

    it("упавшее чтение — ошибка наружу, не «роста нет»", async () => {
      const { ctx, db } = setup(3);
      await expect(
        loadGrowth(
          { ...ctx, db: withBrokenReads(db, ["orders"]) } as unknown as TenantContext,
          now,
        ),
      ).rejects.toThrow();
      await expect(
        loadGrowth(
          { ...ctx, db: withBrokenReads(db, ["bot_users"]) } as unknown as TenantContext,
          now,
        ),
      ).rejects.toThrow();
    });
  });
});
