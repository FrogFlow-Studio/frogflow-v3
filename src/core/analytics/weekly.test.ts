import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isoWeekKey, renderWeekly, weekWindow, WEEKLY_SENT_KEY } from "./weekly";
import { sendWeeklyReport } from "./weekly.server";

const TZ = "Asia/Almaty"; // UTC+5
// Понедельник 28.09.2026, 9:30 в Алматы.
const MONDAY_0930 = new Date("2026-09-28T04:30:00Z");

describe("окно недели", () => {
  it("в понедельник с 9:00 — прошлая неделя пн–вс по поясу магазина", () => {
    const w = weekWindow(MONDAY_0930, TZ);
    expect(w).toMatchObject({ week: "2026-W39", due: true, label: "21.09–27.09" });
    expect(w.from.toISOString()).toBe("2026-09-20T19:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-27T19:00:00.000Z");
    expect(w.prevFrom.toISOString()).toBe("2026-09-13T19:00:00.000Z");
  });
  it("в понедельник до 9:00 ещё рано, во вторник — пора (если крон пропустил)", () => {
    expect(weekWindow(new Date("2026-09-28T03:00:00Z"), TZ).due).toBe(false);
    expect(weekWindow(new Date("2026-09-29T01:00:00Z"), TZ)).toMatchObject({
      week: "2026-W39",
      due: true,
    });
  });
  it("номер недели по ISO на стыке лет", () => {
    expect(isoWeekKey(2025, 12, 29)).toBe("2026-W01");
    expect(isoWeekKey(2027, 1, 3)).toBe("2026-W53");
  });
});

describe("текст отчёта", () => {
  it("выручка с изменением, воронка с долями, лучший канал, топ-3", () => {
    const html = renderWeekly("21.09–27.09", {
      currency: "KZT",
      revenue: 150000,
      orders: 12,
      prevRevenue: 100000,
      prevOrders: 12,
      funnel: [
        { channel: "all", arrived: 40, cart: 20, ordered: 15, paid: 12 },
        { channel: "telegram", arrived: 30, cart: 12, ordered: 9, paid: 7 },
        { channel: "instagram", arrived: 10, cart: 8, ordered: 6, paid: 5 },
      ],
      top: [
        { name: "Прописи <A4>", qty: 5 },
        { name: "Азбука", qty: 3 },
        { name: "Пазл", qty: 2 },
        { name: "Лишний", qty: 1 },
      ],
    });
    expect(html).toContain("Итоги недели 21.09–27.09");
    expect(html).toContain("150000 ₸ (▲ 50 % к прошлой неделе)");
    expect(html).toContain("Оплаченных заказов: 12\n");
    expect(html).toContain("Корзина: 20 (50 %)");
    expect(html).toContain("Лучший канал: Telegram (оплатили 7)");
    expect(html).toContain("1. Прописи &lt;A4&gt; — 5 шт.");
    expect(html).not.toContain("Лишний");
  });
});

function shop(settings: Record<string, string> = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: "t1",
    key,
    value,
  }));
  db.tables.bot_users = [
    { user_key: "tg_1", platform: "telegram", created_at: "2026-09-22T08:00:00Z" },
  ];
  db.tables.cart_items = [];
  db.tables.orders = [
    {
      id: 1,
      user_key: "tg_1",
      telegram_id: 1,
      platform: "telegram",
      status: "delivered",
      fulfillment_kind: "digital",
      total: 5000,
      paid_amount: 5000,
      currency: "KZT",
      created_at: "2026-09-23T08:00:00Z",
    },
  ];
  db.tables.order_items = [
    {
      id: "i1",
      order_id: 1,
      product_id: "p1",
      name_snapshot: "Азбука",
      price_snapshot: 5000,
      quantity: 1,
    },
  ];
  const ctx = { db, tenant: { id: "t1" }, timezone: TZ } as unknown as TenantContext;
  const sent = (db: ReturnType<typeof fakeDb>) =>
    db.tables.app_settings!.find((s) => s.key === WEEKLY_SENT_KEY)?.value;
  return { db, ctx, sent: () => sent(db) };
}

describe("отправка отчёта", () => {
  it("отправляет итоги прошлой недели один раз, второй прогон крона — ничего", async () => {
    const { ctx, sent } = shop();
    const send = vi.fn(async (_html: string) => 1);
    expect(await sendWeeklyReport(ctx, send, MONDAY_0930)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    const html = send.mock.calls[0]![0];
    expect(html).toContain("Выручка: 5000 ₸");
    expect(html).toContain("1. Азбука — 1 шт.");
    expect(sent()).toBe("2026-W39");
    const later = new Date(MONDAY_0930.getTime() + 15 * 60_000);
    expect(await sendWeeklyReport(ctx, send, later)).toBe("already");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("два прогона крона одновременно — отчёт уходит один раз", async () => {
    const { ctx } = shop();
    const send = vi.fn(async (_html: string) => 1);
    const r = await Promise.all([
      sendWeeklyReport(ctx, send, MONDAY_0930),
      sendWeeklyReport(ctx, send, MONDAY_0930),
      sendWeeklyReport(ctx, send, MONDAY_0930),
    ]);
    expect(r.filter((x) => x === "sent")).toHaveLength(1);
    expect(r.filter((x) => x === "already")).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("выключен в настройках — не отправляет и ничего не пишет", async () => {
    const { ctx, sent } = shop({ weekly_report_enabled: "false" });
    const send = vi.fn(async (_html: string) => 1);
    expect(await sendWeeklyReport(ctx, send, MONDAY_0930)).toBe("off");
    expect(send).not.toHaveBeenCalled();
    expect(sent()).toBeUndefined();
  });

  it("до 9 утра понедельника не отправляет; через неделю — следующий отчёт", async () => {
    const { ctx, sent } = shop({ weekly_report_enabled: "true" });
    const send = vi.fn(async (_html: string) => 1);
    expect(await sendWeeklyReport(ctx, send, new Date("2026-09-28T03:00:00Z"))).toBe("notDue");
    expect(send).not.toHaveBeenCalled();
    await sendWeeklyReport(ctx, send, MONDAY_0930);
    const nextMonday = new Date(MONDAY_0930.getTime() + 7 * 86_400_000);
    expect(await sendWeeklyReport(ctx, send, nextMonday)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent()).toBe("2026-W40");
  });
});
