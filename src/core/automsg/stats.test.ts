import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  attributeAuto,
  autoMessageStats,
  recordAutoMessage,
  type AutoEvent,
  type AutoKind,
} from "./stats";

const BOT = "00000000-0000-0000-0000-000000000001";
const T0 = "2026-09-20T10:00:00.000Z";
const at = (h: number) => new Date(Date.parse(T0) + h * 3600_000).toISOString();
const NOW = Date.parse(T0) + 10 * 24 * 3600_000;

const ev = (kind: AutoKind, telegram_id: number, when: string, ok = true): AutoEvent => ({
  kind,
  telegram_id,
  at: when,
  ok,
});
const ord = (telegram_id: number, created_at: string, status: string, total = 1000) => ({
  telegram_id,
  created_at,
  status,
  total,
  currency: "KZT",
});

describe("итоги автосообщений: чистый подсчёт", () => {
  it("заказ после сообщения засчитан, раньше сообщения и позже 7 дней — нет", () => {
    const r = attributeAuto(
      [ev("cart", 1, T0)],
      [
        ord(1, at(5), "delivered", 4000),
        ord(1, at(-1), "delivered", 100),
        ord(1, at(7 * 24 + 1), "delivered", 100),
      ],
    );
    expect(r.cart).toMatchObject({
      sent: 1,
      buyers: 1,
      orders: 1,
      paid: 1,
      revenue: { KZT: 4000 },
    });
  });

  it("неоплаченный заказ — заказ, но не выручка; отменённый и возвращённый — мимо", () => {
    const r = attributeAuto(
      [ev("winback", 1, T0)],
      [ord(1, at(2), "pending", 900), ord(1, at(3), "cancelled"), ord(1, at(4), "refunded")],
    );
    expect(r.winback).toMatchObject({ orders: 1, paid: 0, buyers: 1, revenue: {} });
  });

  it("два сообщения одному покупателю — заказ засчитан один раз, последнему", () => {
    const r = attributeAuto(
      [ev("cart", 1, T0), ev("similar", 1, at(24))],
      [ord(1, at(30), "delivered", 5000)],
    );
    expect(r.similar).toMatchObject({ orders: 1, revenue: { KZT: 5000 } });
    expect(r.cart).toMatchObject({ sent: 1, orders: 0, revenue: {} });
  });

  it("два заказа одного покупателя — один покупатель, два заказа", () => {
    const r = attributeAuto(
      [ev("cart", 1, T0)],
      [ord(1, at(1), "delivered", 100), ord(1, at(2), "delivered", 200)],
    );
    expect(r.cart).toMatchObject({ buyers: 1, orders: 2, paid: 2, revenue: { KZT: 300 } });
  });

  it("неудачная отправка считается отдельно и заказов не приносит", () => {
    const r = attributeAuto([ev("waitlist", 1, T0, false)], [ord(1, at(1), "delivered")]);
    expect(r.waitlist).toMatchObject({ sent: 0, failed: 1, orders: 0 });
  });
});

describe("отметки отправки и чтение итогов", () => {
  const ctxOf = (db: ReturnType<typeof fakeDb>) =>
    ({ tenant: { id: BOT }, db }) as unknown as TenantContext;

  it("recordAutoMessage пишет строку zernio_logs, autoMessageStats её читает", async () => {
    const db = fakeDb();
    db.tables.orders = [
      { id: 1, bot_id: BOT, ...ord(7, new Date(NOW - 3600_000).toISOString(), "delivered", 2500) },
    ];
    const ctx = ctxOf(db);
    await recordAutoMessage(ctx, "cart", 7, true, new Date(NOW - 5 * 3600_000));
    await recordAutoMessage(ctx, "cart", 8, false, new Date(NOW - 5 * 3600_000));
    expect(db.tables.zernio_logs).toHaveLength(2);
    const s = await autoMessageStats(ctx, NOW);
    expect(s.cart).toMatchObject({ sent: 1, failed: 1, buyers: 1, revenue: { KZT: 2500 } });
  });

  it("события старше 30 дней в итог не входят", async () => {
    const db = fakeDb();
    const ctx = ctxOf(db);
    await recordAutoMessage(ctx, "winback", 7, true, new Date(NOW - 31 * 24 * 3600_000));
    const s = await autoMessageStats(ctx, NOW);
    expect(s.winback.sent).toBe(0);
  });

  it("постранично: больше 1000 отметок не обрезаются", async () => {
    const db = fakeDb({ maxRows: 1000 });
    db.tables.zernio_logs = Array.from({ length: 1200 }, (_, i) => ({
      id: `l${String(i).padStart(5, "0")}`,
      bot_id: BOT,
      event_id: `automsg:${BOT}:cart:${i}:1`,
      event_type: "automsg",
      status: "sent",
      payload: { kind: "cart", telegram_id: i + 1 },
      created_at: new Date(NOW - 3600_000).toISOString(),
    }));
    const s = await autoMessageStats(ctxOf(db), NOW);
    expect(s.cart.sent).toBe(1200);
  });
});
