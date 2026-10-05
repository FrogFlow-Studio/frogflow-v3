import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { returningStats, type Purchase } from "./customers";
import { customersBlock } from "./customers.server";

const now = new Date("2026-10-03T10:00:00Z");
const p = (buyer: string, iso: string, amount = 1000, currency = "KZT"): Purchase => ({
  buyer,
  at: new Date(iso).toISOString(),
  amount,
  currency,
});

describe("«Вернулись покупатели» (У3)", () => {
  it("доля вернувшихся и средний чек новых и вернувшихся", () => {
    const r = returningStats(
      [
        p("old", "2026-07-01T10:00:00Z", 5000), // первая покупка до периода
        p("old", "2026-09-25T10:00:00Z", 3000),
        p("old", "2026-09-28T10:00:00Z", 1000),
        p("new1", "2026-09-26T10:00:00Z", 2000),
        p("new2", "2026-10-01T10:00:00Z", 4000),
        p("gone", "2026-06-01T10:00:00Z", 9000), // в периоде не покупал
      ],
      30,
      now,
    );
    expect(r.buyers).toBe(3);
    expect(r.returning).toBe(1);
    expect(r.share).toBe(33);
    expect(r.fresh).toEqual({ buyers: 2, orders: 2, avg: 3000 });
    expect(r.back).toEqual({ buyers: 1, orders: 2, avg: 2000 });
    expect(r.currency).toBe("KZT");
  });

  it("пустой период — нет данных, не нули и не деление на ноль", () => {
    const r = returningStats([p("a", "2026-01-01T10:00:00Z")], 30, now);
    expect(r.buyers).toBe(0);
    expect(r.share).toBeNull();
    expect(r.fresh.avg).toBeNull();
    expect(r.back.avg).toBeNull();
    expect(r.currency).toBeNull();
  });

  it("средний чек не смешивает валюты", () => {
    const r = returningStats(
      [
        p("a", "2026-09-26T10:00:00Z", 1000, "KZT"),
        p("b", "2026-09-27T10:00:00Z", 3000, "KZT"),
        p("c", "2026-09-28T10:00:00Z", 99999, "USD"),
      ],
      30,
      now,
    );
    expect(r.currency).toBe("KZT");
    expect(r.fresh.avg).toBe(2000);
    expect(r.fresh.buyers).toBe(3);
  });

  it("неоплаченные заказы не считаются: на деле, через чтение заказов", async () => {
    const db = fakeDb();
    const BOT = "11111111-1111-1111-1111-111111111111";
    const order = (id: number, key: string, status: string, at: string, total: number) => ({
      id,
      bot_id: BOT,
      user_key: key,
      telegram_id: 1,
      created_at: at,
      total,
      paid_amount: 0,
      currency: "KZT",
      status,
      fulfillment_kind: "digital",
    });
    db.tables.orders = [
      order(1, "tg_1", "delivered", "2026-06-01T10:00:00Z", 5000),
      order(2, "tg_1", "delivered", "2026-09-28T10:00:00Z", 3000),
      order(3, "tg_2", "awaiting_payment", "2026-09-29T10:00:00Z", 7000),
      order(4, "tg_3", "rejected", "2026-09-30T10:00:00Z", 8000),
      order(5, "tg_4", "delivered", "2026-10-01T10:00:00Z", 1000),
    ];
    db.tables.zernio_logs = [];
    db.tables.bot_users = [];
    const ctx = { tenant: { id: BOT }, db, timezone: "Asia/Almaty" } as unknown as TenantContext;
    const block = await customersBlock(ctx, 30, now);
    expect(block.period.buyers).toBe(2);
    expect(block.period.returning).toBe(1);
    expect(block.period.share).toBe(50);
    expect(block.period.back).toEqual({ buyers: 1, orders: 1, avg: 3000 });
    expect(block.period.fresh).toEqual({ buyers: 1, orders: 1, avg: 1000 });
  });
});
