import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { sendFulfillmentReminders, type FulfillmentReminder } from "./fulfillment";

const BOT = "00000000-0000-0000-0000-000000000001";
const H = 60 * 60 * 1000;
const NOW = new Date("2026-09-20T12:00:00Z");

type Row = Record<string, unknown>;
type Filters = { filters: Array<(r: Row) => boolean> };

/**
 * Фейковой базе не хватает фильтров выборки крона (.not/.gt/.lte) —
 * добавляем их прототипу запроса только в этом файле, по смыслу PostgREST.
 */
function withRangeFilters(db: FakeDb): FakeDb {
  const proto = Object.getPrototypeOf(db.from("orders")) as Record<string, unknown>;
  if (proto.not) return db;
  proto.not = function (this: Filters, col: string, op: string, v: unknown) {
    if (op !== "is") throw new Error(`not.${op} не поддержан`);
    this.filters.push((r) => (r[col] ?? null) !== v);
    return this;
  };
  proto.gt = function (this: Filters, col: string, v: string | number) {
    this.filters.push((r) => r[col] != null && (r[col] as string | number) > v);
    return this;
  };
  proto.lte = function (this: Filters, col: string, v: string | number) {
    this.filters.push((r) => r[col] != null && (r[col] as string | number) <= v);
    return this;
  };
  return db;
}

function setup(orders: Array<{ id: number; status: string; inHours: number }>) {
  const db = withRangeFilters(fakeDb());
  db.tables.orders = orders.map((o) => ({
    id: o.id,
    bot_id: BOT,
    order_no: o.id,
    display_no: o.id,
    telegram_id: 1000 + o.id,
    platform: "telegram",
    status: o.status,
    fulfillment_kind: "physical",
    fulfillment_type: "pickup",
    fulfillment_address: null,
    fulfillment_at: new Date(NOW.getTime() + o.inHours * H).toISOString(),
    fulfillment_reminder_sent_at: null,
  }));
  const ctx = {
    tenant: { id: BOT, settings: { default_locale: "ru" }, modules: {} },
    db,
  } as unknown as TenantContext;
  const sent: FulfillmentReminder[] = [];
  const notify = async (r: FulfillmentReminder) => {
    sent.push(r);
  };
  const row = (id: number) => db.tables.orders!.find((o) => o.id === id)!;
  return { ctx, sent, notify, row };
}

describe("sendFulfillmentReminders — напоминание о дате получения", () => {
  it("заказ в ближайшие 24 часа — напоминание отправлено и проставлено ровно один раз", async () => {
    const { ctx, sent, notify, row } = setup([{ id: 1, status: "accepted", inHours: 10 }]);
    const first = await sendFulfillmentReminders(ctx, notify, NOW);
    expect(first.sent).toBe(1);
    const stamp = row(1).fulfillment_reminder_sent_at;
    expect(stamp).not.toBeNull();

    // Повторный запуск крона — заказ больше не попадает в выборку.
    const second = await sendFulfillmentReminders(ctx, notify, new Date(NOW.getTime() + H));
    expect(second).toEqual({ checked: 0, sent: 0 });
    expect(row(1).fulfillment_reminder_sent_at).toBe(stamp);
    expect(sent.map((r) => r.orderId)).toEqual([1]);
  });

  it("два пересёкшихся запуска крона шлют одно напоминание", async () => {
    const { ctx, sent, notify } = setup([{ id: 1, status: "accepted", inHours: 10 }]);
    await Promise.all([
      sendFulfillmentReminders(ctx, notify, NOW),
      sendFulfillmentReminders(ctx, notify, NOW),
    ]);
    expect(sent).toHaveLength(1);
  });

  it("дата получения дальше суток — заказ не трогается", async () => {
    const { ctx, sent, notify, row } = setup([{ id: 1, status: "accepted", inHours: 72 }]);
    await sendFulfillmentReminders(ctx, notify, NOW);
    expect(row(1).fulfillment_reminder_sent_at).toBeNull();
    expect(sent).toEqual([]);
  });

  it("заказ ещё не принят продавцом (awaiting_confirmation), но дата уже завтра — напоминание всё равно шлём", async () => {
    const { ctx, sent, notify, row } = setup([
      { id: 1, status: "awaiting_confirmation", inHours: 10 },
    ]);
    await sendFulfillmentReminders(ctx, notify, NOW);
    expect(row(1).fulfillment_reminder_sent_at).not.toBeNull();
    expect(sent.map((r) => r.orderId)).toEqual([1]);
  });

  it("заказ уже выдан (delivered) — напоминание не шлём", async () => {
    const { ctx, sent, notify, row } = setup([
      { id: 1, status: "delivered", inHours: 10 },
      { id: 2, status: "rejected", inHours: 10 },
    ]);
    await sendFulfillmentReminders(ctx, notify, NOW);
    expect(row(1).fulfillment_reminder_sent_at).toBeNull();
    expect(row(2).fulfillment_reminder_sent_at).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe("напоминание: слоты и загрузка дня", () => {
  const settings = (db: FakeDb, pairs: Record<string, string>) => {
    db.tables.app_settings = Object.entries(pairs).map(([key, value]) => ({
      bot_id: BOT,
      key,
      value,
    }));
  };

  it("время заказа называется слотом магазина, а не «с 10:00»", async () => {
    const { ctx, sent, notify } = setup([{ id: 1, status: "accepted", inHours: 10 }]);
    const db = ctx.db as unknown as FakeDb;
    const at = new Date("2026-09-21T10:00:00Z"); // через 22 часа от NOW
    db.tables.orders![0]!.fulfillment_at = at.toISOString();
    settings(db, { fulfillment_slots: "10:00–12:00\n12:00–14:00" });
    await sendFulfillmentReminders(ctx, notify, NOW);
    expect(sent[0]!.dateLabel).toMatch(/, 10:00–12:00$/);
  });

  it("при лимитах продавцу идёт загрузка дня и слота; без лимитов её нет", async () => {
    const withLimits = setup([
      { id: 1, status: "accepted", inHours: 10 },
      { id: 2, status: "accepted", inHours: 10 },
    ]);
    const db = withLimits.ctx.db as unknown as FakeDb;
    const at = new Date("2026-09-21T10:00:00Z"); // через 22 часа от NOW
    for (const o of db.tables.orders!) o.fulfillment_at = at.toISOString();
    settings(db, {
      fulfillment_slots: "10:00–12:00",
      fulfillment_day_limit: "5",
      fulfillment_slot_limit: "3",
    });
    await sendFulfillmentReminders(withLimits.ctx, withLimits.notify, NOW);
    expect(withLimits.sent[0]!.load).toEqual({
      total: 2,
      dayLimit: 5,
      slotCount: 2,
      slotLimit: 3,
    });
    const plain = setup([{ id: 1, status: "accepted", inHours: 10 }]);
    await sendFulfillmentReminders(plain.ctx, plain.notify, NOW);
    expect(plain.sent[0]!.load).toBeNull();
  });
});
