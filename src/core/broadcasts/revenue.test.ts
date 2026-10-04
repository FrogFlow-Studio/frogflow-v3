import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ATTRIBUTION_MS, attribute, revenueFor } from "./revenue";

const BOT = "00000000-0000-0000-0000-000000000001";
const SENT = "2026-09-20T10:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(SENT) + hours * 3600_000).toISOString();
const NOW = Date.parse(SENT) + 10 * 24 * 3600_000;

function order(id: number, telegram_id: number, created_at: string, status: string, total = 1000) {
  return { id, bot_id: BOT, telegram_id, created_at, status, total, currency: "KZT" };
}

describe("«Принесла» у рассылки", () => {
  it("в счёт — заказы получателя за 72 часа после его отправки; выручка — только оплаченные", () => {
    const r = attribute(
      [
        { telegram_id: 1, sent_at: SENT },
        { telegram_id: 2, sent_at: SENT },
      ],
      [
        { telegram_id: 1, created_at: at(5), status: "delivered", total: 4900, currency: "KZT" },
        { telegram_id: 2, created_at: at(70), status: "pending", total: 900, currency: "KZT" },
        { telegram_id: 2, created_at: at(71), status: "accepted", total: 20, currency: "usd" },
        // до отправки, после окна, отменённый и возвращённый — мимо
        { telegram_id: 1, created_at: at(-1), status: "delivered", total: 500, currency: "KZT" },
        { telegram_id: 1, created_at: at(73), status: "delivered", total: 500, currency: "KZT" },
        { telegram_id: 1, created_at: at(6), status: "cancelled", total: 500, currency: "KZT" },
        { telegram_id: 2, created_at: at(6), status: "refunded", total: 500, currency: "KZT" },
        // не получатель
        { telegram_id: 9, created_at: at(1), status: "delivered", total: 500, currency: "KZT" },
      ],
      NOW,
    );
    expect(r).toEqual({ orders: 3, paid: 2, revenue: { KZT: 4900, USD: 20 }, windowOpen: false });
  });

  it("пока 72 часа не прошли — окно открыто", () => {
    const r = attribute(
      [{ telegram_id: 1, sent_at: SENT }],
      [],
      Date.parse(SENT) + ATTRIBUTION_MS - 1,
    );
    expect(r.windowOpen).toBe(true);
  });

  it("из базы: только отправленным получателям, заказы читаются кусками больше 200", async () => {
    const db = fakeDb();
    // 450 отправленных получателей — три куска по 200 в .in
    db.tables.broadcast_recipients = Array.from({ length: 450 }, (_, i) => ({
      id: `r${String(i).padStart(4, "0")}`,
      bot_id: BOT,
      broadcast_id: "b1",
      telegram_id: i + 1,
      status: "sent",
      sent_at: SENT,
    }));
    db.tables.broadcast_recipients.push({
      id: "rx",
      bot_id: BOT,
      broadcast_id: "b1",
      telegram_id: 9999,
      status: "failed",
      sent_at: null,
    });
    db.tables.orders = [
      order(1, 5, at(2), "delivered", 3000),
      order(2, 444, at(30), "ready", 7000),
      order(3, 9999, at(2), "delivered", 100000),
      order(4, 300, at(100), "delivered", 100000),
    ];
    const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;
    const out = await revenueFor(ctx, ["b1", "b2"], NOW);
    expect(out.b1).toEqual({ orders: 2, paid: 2, revenue: { KZT: 10000 }, windowOpen: false });
    expect(out.b2).toEqual({ orders: 0, paid: 0, revenue: {}, windowOpen: false });
  });
  it("итог закрытого окна считается один раз: повторное открытие не читает получателей", async () => {
    const db = fakeDb();
    const FRESH = new Date(NOW - 3600_000).toISOString();
    const recipients = (id: string, sentAt: string) =>
      [1, 2, 3].map((n) => ({
        id: `${id}-${n}`,
        bot_id: BOT,
        broadcast_id: id,
        telegram_id: n,
        status: "sent",
        sent_at: sentAt,
      }));
    db.tables.broadcast_recipients = [
      ...recipients("closed1", SENT),
      ...recipients("closed2", SENT),
      ...recipients("open", FRESH),
    ];
    db.tables.orders = [order(1, 1, at(2), "delivered", 5000)];
    db.tables.app_settings = [];
    const reads: string[] = [];
    const realFrom = db.from.bind(db);
    (db as { from: unknown }).from = (table: string) => {
      reads.push(table);
      return realFrom(table);
    };
    const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;
    const ids = ["closed1", "closed2", "open"];

    const first = await revenueFor(ctx, ids, NOW);
    expect(first.closed1).toEqual({
      orders: 1,
      paid: 1,
      revenue: { KZT: 5000 },
      windowOpen: false,
    });
    expect(first.open?.windowOpen).toBe(true);

    reads.length = 0;
    const second = await revenueFor(ctx, ids, NOW);
    expect(second.closed1).toEqual(first.closed1);
    expect(second.closed2).toEqual(first.closed2);
    // получателей читаем только у рассылки с открытым окном: один запрос, не три
    expect(reads.filter((t) => t === "broadcast_recipients")).toHaveLength(1);
  });
  it("итог не фиксируется, пока в окне есть заказ, ждущий оплаты; потом фиксируется с выручкой", async () => {
    const db = fakeDb();
    db.tables.broadcast_recipients = [
      { id: "r1", bot_id: BOT, broadcast_id: "b1", telegram_id: 1, status: "sent", sent_at: SENT },
    ];
    db.tables.orders = [order(1, 1, at(70), "awaiting_confirmation", 4000)];
    db.tables.app_settings = [];
    const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;

    const DAY5 = Date.parse(SENT) + 5 * 24 * 3600_000;
    const waiting = await revenueFor(ctx, ["b1"], DAY5);
    expect(waiting.b1).toEqual({ orders: 1, paid: 0, revenue: {}, windowOpen: false });
    expect(db.tables.app_settings).toHaveLength(0);

    db.tables.orders![0]!.status = "delivered";
    const paid = await revenueFor(ctx, ["b1"], DAY5);
    expect(paid.b1).toEqual({ orders: 1, paid: 1, revenue: { KZT: 4000 }, windowOpen: false });
    expect(db.tables.app_settings).toHaveLength(1);
  });

  it("заказ так и не оплатили 7 дней после окна — итог фиксируется как есть", async () => {
    const db = fakeDb();
    db.tables.broadcast_recipients = [
      { id: "r1", bot_id: BOT, broadcast_id: "b1", telegram_id: 1, status: "sent", sent_at: SENT },
    ];
    db.tables.orders = [order(1, 1, at(70), "awaiting_payment", 4000)];
    db.tables.app_settings = [];
    const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;
    const lastDay = Date.parse(SENT) + ATTRIBUTION_MS + 7 * 24 * 3600_000;

    await revenueFor(ctx, ["b1"], lastDay - 1);
    expect(db.tables.app_settings).toHaveLength(0);
    const out = await revenueFor(ctx, ["b1"], lastDay);
    expect(out.b1).toEqual({ orders: 1, paid: 0, revenue: {}, windowOpen: false });
    expect(db.tables.app_settings).toHaveLength(1);
  });
});
