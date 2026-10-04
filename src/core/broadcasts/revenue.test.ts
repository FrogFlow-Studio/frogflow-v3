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
});
