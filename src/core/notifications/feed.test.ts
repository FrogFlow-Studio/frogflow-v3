import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    from: (t: string) => (state.db as { from: (t: string) => unknown }).from(t),
  }),
  tenantDb: () => ({}),
}));

const { groupFeed, isRead, listNotifications, sortFeed, typesForRole } = await import("./feed");
const { patchTenantSettings } = await import("@/core/tenant/resolve.server");

/** Центр уведомлений: события из журналов, чужие не видны, роли и «прочитано». */
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-04T10:00:00Z");
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup(db: FakeDb = fakeDb({ maxRows: 1000 })) {
  db.tables.orders = [
    {
      id: 1,
      bot_id: ME,
      order_no: 1,
      display_no: 11,
      display_name: "Айгуль",
      total: 5000,
      currency: "KZT",
    },
    {
      id: 2,
      bot_id: OTHER,
      order_no: 2,
      display_no: null,
      display_name: "Чужой",
      total: 900,
      currency: "KZT",
    },
  ];
  const ev = (n: number, bot: string, type: string, at: string, order: number, extra = {}) => ({
    id: uid(n),
    bot_id: bot,
    event_id: `e${n}`,
    event_type: type,
    status: "event",
    created_at: at,
    payload: { order_id: order, ...extra },
  });
  db.tables.zernio_logs = [
    ev(1, ME, "order.placed", "2026-10-04T08:00:00Z", 1),
    ev(2, ME, "order.proof", "2026-10-04T09:00:00Z", 1),
    ev(3, ME, "order.refund", "2026-10-03T09:00:00Z", 1, { amount: 1500, currency: "KZT" }),
    ev(4, ME, "order.payment", "2026-10-04T09:30:00Z", 1),
    ev(5, OTHER, "order.placed", "2026-10-04T09:40:00Z", 2),
    ev(6, ME, "order.placed", "2026-08-01T09:00:00Z", 1),
    ev(7, ME, "order.placed", "2026-10-04T09:50:00Z", 99),
  ];
  db.tables.product_reviews = [
    {
      id: uid(50),
      bot_id: ME,
      product_id: uid(60),
      telegram_id: 1,
      rating: 4,
      comment: "Вкусно",
      created_at: "2026-10-04T07:00:00Z",
    },
    {
      id: uid(51),
      bot_id: OTHER,
      product_id: uid(61),
      telegram_id: 1,
      rating: 1,
      comment: "чужой",
      created_at: "2026-10-04T07:10:00Z",
    },
  ];
  return { ctx: { tenant: { id: ME }, db } as unknown as TenantContext, db };
}

describe("лента уведомлений", () => {
  it("свои заказы, чеки, возвраты и отзывы; чужой магазин, платежи и старше 30 дней — нет", async () => {
    const { ctx } = setup();
    const feed = await listNotifications(ctx, { role: undefined, now: NOW });
    expect(feed.items.map((i) => [i.type, i.orderNo])).toEqual([
      ["receipt", 11],
      ["order", 11],
      ["review", null],
      ["refund", 11],
    ]);
    expect(feed.items.find((i) => i.type === "refund")).toMatchObject({ amount: 1500 });
    expect(feed.items.find((i) => i.type === "order")?.buyer).toBe("Айгуль");
    expect(JSON.stringify(feed)).not.toContain("Чужой");
    expect(JSON.stringify(feed)).not.toContain("чужой");
  });

  it("бухгалтер: без отзывов и без имён покупателей", async () => {
    const { ctx } = setup();
    expect(typesForRole("accountant")).not.toContain("review");
    const feed = await listNotifications(ctx, { role: "accountant", now: NOW });
    expect(feed.items.map((i) => i.type)).toEqual(["receipt", "order", "refund"]);
    expect(feed.items.every((i) => i.buyer === null)).toBe(true);
  });

  it("«прочитано» — всё не новее отметки", async () => {
    const { ctx } = setup();
    const feed = await listNotifications(ctx, {
      role: undefined,
      readAt: "2026-10-04T08:30:00Z",
      now: NOW,
    });
    expect(feed.items.map((i) => i.read)).toEqual([false, true, true, true]);
    expect(feed.unread).toBe(1);
    expect(isRead("2026-10-04T08:30:00Z", "2026-10-04T08:30:00Z")).toBe(true);
    expect(isRead("2026-10-04T08:30:01Z", "2026-10-04T08:30:00Z")).toBe(false);
    expect(isRead("2026-10-04T08:30:00Z", undefined)).toBe(false);
  });

  it("длинная история читается постранично: тысяча с лишним событий не теряется в счёте", async () => {
    const { ctx, db } = setup();
    db.tables.zernio_logs = Array.from({ length: 1500 }, (_, i) => ({
      id: uid(1000 + i),
      bot_id: ME,
      event_id: `x${i}`,
      event_type: "order.placed",
      status: "event",
      created_at: "2026-10-04T08:00:00Z",
      payload: { order_id: 1 },
    }));
    const feed = await listNotifications(ctx, { role: "accountant", now: NOW });
    expect(feed.total).toBe(1500);
    expect(feed.items).toHaveLength(100);
  });

  it("порядок: свежие первыми, одинаковое время — по id", () => {
    const sorted = sortFeed([
      { at: "2026-10-04T08:00:00Z", id: "a" },
      { at: "2026-10-04T09:00:00Z", id: "b" },
      { at: "2026-10-04T08:00:00Z", id: "c" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("«сегодня» и «раньше» — по часовому поясу магазина", () => {
    const items = [{ at: "2026-10-03T20:00:00Z" }, { at: "2026-10-04T01:00:00Z" }];
    // В Алматы (UTC+5) оба — уже 4 октября; в UTC первое — вчера.
    expect(groupFeed(items, "Asia/Almaty", NOW).today).toHaveLength(2);
    const utc = groupFeed(items, "UTC", NOW);
    expect(utc.today).toHaveLength(1);
    expect(utc.earlier).toHaveLength(1);
  });
});

describe("отметка «прочитано»", () => {
  it("пишется через patchTenantSettings и не затирает остальные настройки и чужие отметки", async () => {
    const db = fakeDb();
    db.tables.bots = [
      {
        id: ME,
        settings: {
          rev: 3,
          slug: "shop",
          served_by: "v2",
          notify_read: { "admin:kate": "2026-10-01T00:00:00.000Z" },
        },
      },
    ];
    state.db = db;
    await patchTenantSettings(ME, { notify_read: { "admin:ivan": "2026-10-04T10:00:00.000Z" } });
    const s = db.tables.bots![0]!.settings as Record<string, unknown>;
    expect(s).toMatchObject({
      slug: "shop",
      served_by: "v2",
      notify_read: {
        "admin:kate": "2026-10-01T00:00:00.000Z",
        "admin:ivan": "2026-10-04T10:00:00.000Z",
      },
    });
    expect(Number(s.rev)).toBeGreaterThan(3);
  });
});
