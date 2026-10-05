import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { computeTrust, refreshTrust } from "./trust.server";
import { TRUST_KEY, parseTrust } from "./trust";

const BOT = "b1";
const NOW = new Date("2026-10-05T12:00:00Z");
const ctxFor = (db: FakeDb) =>
  ({
    tenant: { id: BOT, name: "Лавка", vertical: "shop", modules: {}, settings: {} },
    db,
  }) as unknown as TenantContext;
const hoursAfter = (iso: string, h: number) =>
  new Date(Date.parse(iso) + h * 3_600_000).toISOString();

let db: FakeDb;
const order = (id: number, status: string, created = "2026-09-20T10:00:00.000Z", bot = BOT) => ({
  id,
  bot_id: bot,
  status,
  created_at: created,
});
const sellerEvent = (id: number, created: string, actor = "admin") => ({
  id: `e${id}${actor}`,
  bot_id: BOT,
  event_type: "order.status",
  created_at: created,
  payload: { order_id: id, actor, to: "accepted" },
});

beforeEach(() => {
  db = fakeDb();
});

describe("доверие автора по настоящим заказам (П3)", () => {
  it("считаются только выданные: ждущие оплаты, отменённые и отклонённые — нет; чужой магазин — нет", async () => {
    db.tables.orders = [
      ...Array.from({ length: 12 }, (_, i) => order(i + 1, "delivered")),
      ...Array.from({ length: 30 }, (_, i) =>
        order(100 + i, i % 3 === 0 ? "cancelled" : i % 3 === 1 ? "awaiting_payment" : "rejected"),
      ),
      order(500, "delivered", "2026-09-20T10:00:00.000Z", "other"),
    ];
    const t = await computeTrust(ctxFor(db), { rating: 4.5, count: 3 }, NOW);
    expect(t.delivered).toBe(10);
    expect(t).toMatchObject({ rating: 4.5, ratingCount: 3, answerHours: null });
  });

  it("время ответа: действия продавца по выданным заказам; автоматические и чужие не считаются", async () => {
    const created = "2026-09-20T10:00:00.000Z";
    db.tables.orders = [1, 2, 3, 4, 5, 6].map((id) => order(id, "delivered", created));
    db.tables.orders.push(order(7, "cancelled", created));
    db.tables.zernio_logs = [
      sellerEvent(1, hoursAfter(created, 1)),
      sellerEvent(2, hoursAfter(created, 2)),
      sellerEvent(3, hoursAfter(created, 3)),
      sellerEvent(4, hoursAfter(created, 4)),
      sellerEvent(5, hoursAfter(created, 5)),
      // автоматический переход и действие по отменённому заказу ответом не считаются
      sellerEvent(6, hoursAfter(created, 99), "bot"),
      sellerEvent(7, hoursAfter(created, 99)),
      // повторное действие по тому же заказу — берётся первое
      sellerEvent(1, hoursAfter(created, 50)),
    ];
    const t = await computeTrust(ctxFor(db), { rating: null, count: 0 }, NOW);
    expect(t.answerHours).toBe(3);
  });

  it("заказы старше 90 дней в время ответа не идут, но в «выдано» остаются", async () => {
    const old = "2026-05-01T10:00:00.000Z";
    db.tables.orders = Array.from({ length: 12 }, (_, i) => order(i + 1, "delivered", old));
    db.tables.zernio_logs = Array.from({ length: 12 }, (_, i) =>
      sellerEvent(i + 1, hoursAfter(old, 1)),
    );
    const t = await computeTrust(ctxFor(db), { rating: null, count: 0 }, NOW);
    expect(t.delivered).toBe(10);
    expect(t.answerHours).toBeNull();
  });

  it("не удалось прочитать заказы или журнал — ошибка, а не «заказов нет»", async () => {
    db.tables.orders = [order(1, "delivered")];
    await expect(
      computeTrust(ctxFor(withBrokenReads(db, ["orders"])), { rating: null, count: 0 }, NOW),
    ).rejects.toThrow();
    await expect(
      computeTrust(ctxFor(withBrokenReads(db, ["zernio_logs"])), { rating: null, count: 0 }, NOW),
    ).rejects.toThrow();
  });

  it("запись в настройки магазина читается обратно; повтор перезаписывает, а не дублирует", async () => {
    db.tables.orders = Array.from({ length: 25 }, (_, i) => order(i + 1, "delivered"));
    expect(await refreshTrust(ctxFor(db), { rating: 4.8, count: 9 }, NOW)).toBe(true);
    expect(await refreshTrust(ctxFor(db), { rating: 4.8, count: 9 }, NOW)).toBe(true);
    const rows = (db.tables.app_settings ?? []).filter((r) => r.key === TRUST_KEY);
    expect(rows).toHaveLength(1);
    expect(parseTrust(String(rows[0]!.value))).toMatchObject({
      delivered: 20,
      rating: 4.8,
      ratingCount: 9,
    });
  });
});
