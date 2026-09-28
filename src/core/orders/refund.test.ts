import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  checkRefund,
  netOfRefunds,
  receivedAmount,
  refundOrder,
  refundedAmount,
  refundsSince,
} from "./refund";

const BOT = "00000000-0000-0000-0000-0000000000af";
const TG = 777;
let db: FakeDb;
let ctx: TenantContext;

function order(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    bot_id: BOT,
    status: "delivered",
    total: 10000,
    paid_amount: 0,
    currency: "KZT",
    fulfillment_kind: "digital",
    telegram_id: TG,
    points_used: 0,
    points_earned: 0,
    promo_code: null,
    platform: "telegram",
    updated_at: "2026-09-28T10:00:00.000Z",
    created_at: "2026-09-28T09:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.orders = [order()];
  db.tables.order_items = [];
  db.tables.zernio_logs = [];
  db.tables.gift_certificates = [];
  db.tables.promo_codes = [];
  db.tables.bot_users = [
    { bot_id: BOT, telegram_id: TG, user_key: `tg_${TG}`, loyalty_points: 50 },
  ];
  ctx = {
    db,
    tenant: { id: BOT, modules: { loyalty: true, stock: false } },
  } as unknown as TenantContext;
});

describe("сколько можно вернуть", () => {
  it("цифровой — итог; физический — внесённое, выданный — не меньше итога", () => {
    expect(receivedAmount({ status: "delivered", total: 100 })).toBe(100);
    const phys = { total: 100, paid_amount: 30, fulfillment_kind: "physical" };
    expect(receivedAmount({ ...phys, status: "accepted" })).toBe(30);
    expect(receivedAmount({ ...phys, status: "delivered" })).toBe(100);
  });

  it("ноль и больше остатка — отказ; ровно остаток — полный возврат", () => {
    expect(checkRefund(100, 0, 0)).toMatchObject({ ok: false, reason: "amount" });
    expect(checkRefund(100, 40, 60.01)).toMatchObject({ ok: false, reason: "over", remaining: 60 });
    expect(checkRefund(100, 40, 60)).toEqual({ ok: true, full: true, remaining: 0 });
    expect(checkRefund(100, 0, 25.5)).toEqual({ ok: true, full: false, remaining: 74.5 });
  });

  it("выручка за вычетом возврата не уходит в минус", () => {
    expect(netOfRefunds(100, undefined)).toBe(100);
    expect(netOfRefunds(100, 30)).toBe(70);
    expect(netOfRefunds(100, 130)).toBe(0);
  });
});

describe("возврат по заказу", () => {
  it("частичный: статус прежний, событие с суммой и причиной, остаток считается по событиям", async () => {
    const r = await refundOrder(ctx, 5, { amount: 3000, reason: "  брак  " }, "admin:Анна");
    expect(r).toMatchObject({ full: false, amount: 3000, remaining: 7000 });
    expect(db.tables.orders![0]!.status).toBe("delivered");
    expect(await refundedAmount(ctx, 5)).toBe(3000);
    const ev = db.tables.zernio_logs!.find((e) => e.event_type === "order.refund")!;
    expect(ev.payload).toMatchObject({ order_id: 5, amount: 3000, currency: "KZT", full: false });
    expect((ev.payload as { reason: string }).reason).toBe("брак");
    await expect(refundOrder(ctx, 5, { amount: 7000.01 })).rejects.toThrow(/не больше/);
  });

  it("два одновременных частичных возврата не вернут больше полученного", async () => {
    const r = await Promise.allSettled([
      refundOrder(ctx, 5, { amount: 6000 }),
      refundOrder(ctx, 5, { amount: 6000 }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await refundedAmount(ctx, 5)).toBe(6000);
    // Следующий возврат — уже под следующим номером.
    await refundOrder(ctx, 5, { amount: 4000 });
    expect(await refundedAmount(ctx, 5)).toBe(10000);
  });

  it("полный: статус refunded, списанные баллы вернулись, начисленные сняты", async () => {
    db.tables.orders = [order({ points_used: 20, points_earned: 10 })];
    const r = await refundOrder(ctx, 5, { amount: 10000 });
    expect(r).toMatchObject({ full: true, pointsReturned: 20, pointsRevoked: 10, remaining: 0 });
    expect(db.tables.orders![0]!.status).toBe("refunded");
    expect(db.tables.bot_users![0]!.loyalty_points).toBe(60);
    await expect(refundOrder(ctx, 5, { amount: 1 })).rejects.toThrow(/денег не получено/);
  });

  it("начисленные уже потрачены — не снимаем, баланс не уходит в минус", async () => {
    db.tables.orders = [order({ points_earned: 500 })];
    const r = await refundOrder(ctx, 5, { amount: 10000 });
    expect(r.pointsRevoked).toBe(0);
    expect(db.tables.bot_users![0]!.loyalty_points).toBe(50);
  });

  it("неоплаченный и отклонённый заказ вернуть нельзя", async () => {
    for (const status of ["awaiting_payment", "awaiting_confirmation", "rejected", "cancelled"]) {
      db.tables.orders = [order({ status })];
      await expect(refundOrder(ctx, 5, { amount: 1 })).rejects.toThrow(/денег не получено/);
    }
    expect(db.tables.zernio_logs!).toHaveLength(0);
  });

  it("заказ изменился между чтением и записью — отказ, события нет", async () => {
    const from = db.from.bind(db);
    let reads = 0;
    db.from = (t: string) => {
      // Первый запрос к orders — чтение; до условной записи другой возврат
      // успел поменять строку (updated_at двигает триггер).
      if (t === "orders" && ++reads === 2)
        db.tables.orders![0]!.updated_at = "2026-09-28T10:00:01Z";
      return from(t);
    };
    await expect(refundOrder(ctx, 5, { amount: 100 })).rejects.toThrow(/изменился/);
    expect(db.tables.zernio_logs!).toHaveLength(0);
  });

  it("возвраты для выручки: сумма по заказам с начала периода", async () => {
    await refundOrder(ctx, 5, { amount: 1000 });
    await refundOrder(ctx, 5, { amount: 500 });
    // created_at по умолчанию ставит Postgres, база в памяти — нет.
    for (const e of db.tables.zernio_logs!) e.created_at = "2026-09-28T12:00:00Z";
    expect((await refundsSince(ctx, "2026-09-29T00:00:00Z")).size).toBe(0);
    const m = await refundsSince(ctx, "2026-01-01T00:00:00Z");
    expect(m.get(5)).toBe(1500);
  });
});
