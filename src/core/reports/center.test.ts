import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { analytics } from "@/core/analytics/analytics";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { availableReports, centerReport, delta, reportCsv } from "./center";

const BOT = "00000000-0000-0000-0000-000000000001";
const DAY = 86_400_000;
const ago = (d: number, h = 0) => new Date(Date.now() - d * DAY - h * 3_600_000).toISOString();

const ctxWith = (db: ReturnType<typeof fakeDb>) =>
  ({ tenant: { id: BOT, modules: {} }, timezone: "Asia/Almaty", db }) as unknown as TenantContext;

let nextId = 1;
const order = (o: Record<string, unknown>) => ({
  id: nextId++,
  bot_id: BOT,
  total: 1000,
  paid_amount: null,
  currency: "KZT",
  status: "delivered",
  fulfillment_kind: "digital",
  platform: "telegram",
  telegram_id: 1,
  points_earned: 0,
  points_used: 0,
  ...o,
});

function dataset() {
  nextId = 1;
  const db = fakeDb({ maxRows: 1000 });
  db.tables.orders = [
    order({ created_at: ago(1), total: 5000, telegram_id: 10, points_earned: 50 }),
    order({
      created_at: ago(2),
      total: 3000,
      telegram_id: 11,
      platform: "instagram",
      points_used: 30,
    }),
    order({ created_at: ago(3), total: 9000, status: "awaiting_payment", points_earned: 90 }),
    order({ created_at: ago(2), total: 700, status: "rejected" }),
    order({ created_at: ago(3), total: 800, status: "cancelled" }),
    order({ created_at: ago(9), total: 4000, telegram_id: 14, points_earned: 40 }),
    order({ created_at: ago(10), total: 700, status: "cancelled" }),
  ];
  db.tables.order_items = [];
  db.tables.bot_users = [];
  db.tables.broadcasts = [
    {
      id: 1,
      bot_id: BOT,
      status: "completed",
      created_at: ago(2),
      sent_count: 10,
      failed_count: 1,
      blocked_count: 2,
    },
    {
      id: 2,
      bot_id: BOT,
      status: "draft",
      created_at: ago(2),
      sent_count: 99,
      failed_count: 0,
      blocked_count: 0,
    },
    {
      id: 3,
      bot_id: BOT,
      status: "completed",
      created_at: ago(10),
      sent_count: 5,
      failed_count: 0,
      blocked_count: 0,
    },
  ];
  return db;
}

describe("центр отчётов", () => {
  it("продажи совпадают с «Аналитикой»: та же выручка, заказы и сравнение", async () => {
    const ctx = ctxWith(dataset());
    const a = await analytics(ctx, 7);
    const r = await centerReport(ctx, "sales", 7);
    const get = (k: string) => r.metrics.find((m) => m.key === k)!;
    expect(get("revenue").current).toBe(a.current.revenue);
    expect(get("revenue").previous).toBe(a.previous.revenue);
    expect(get("orders").current).toBe(a.current.orders);
    // неоплаченный заказ на 9000 в выручку не попал
    expect(get("revenue").current).toBe(8000);
    expect(r.table?.rows).toEqual(a.byPlatform.map((x) => [x.platform, x.orders, x.revenue]));
    expect(r.table?.rows).toHaveLength(2);
  });

  it("баллы: только из учтённых заказов, текущий и прошлый период", async () => {
    const r = await centerReport(ctxWith(dataset()), "points", 7);
    expect(r.metrics).toEqual([
      { key: "pointsEarned", current: 50, previous: 40 },
      { key: "pointsUsed", current: 30, previous: 0 },
    ]);
  });

  it("отказы: отклонённые и отменённые считаются по периодам", async () => {
    const r = await centerReport(ctxWith(dataset()), "refusals", 7);
    const get = (k: string) => r.metrics.find((m) => m.key === k)!;
    expect([get("rejected").current, get("cancelled").current, get("cancelled").previous]).toEqual([
      1, 1, 1,
    ]);
  });

  it("рассылки: только завершённые", async () => {
    const r = await centerReport(ctxWith(dataset()), "broadcasts", 7);
    expect(r.metrics).toEqual([
      { key: "bcCount", current: 1, previous: 1 },
      { key: "bcSent", current: 10, previous: 5 },
      { key: "bcFailed", current: 1, previous: 0 },
      { key: "bcBlocked", current: 2, previous: 0 },
    ]);
  });

  it("больше 1000 заказов — ничего не теряется (баллы постранично)", async () => {
    nextId = 1;
    const db = fakeDb({ maxRows: 1000 });
    db.tables.orders = Array.from({ length: 2500 }, (_, i) =>
      order({ created_at: ago(1, i % 20), points_earned: 2, telegram_id: 100 + i }),
    );
    db.tables.order_items = [];
    db.tables.bot_users = [];
    const r = await centerReport(ctxWith(db), "points", 7);
    expect(r.metrics[0]!.current).toBe(5000);
  });

  it("доступность: бухгалтер без склада и рассылок, модуль выключен — отчёта нет", () => {
    expect(availableReports({}, false)).toEqual(["sales", "refusals"]);
    const all = { profit: true, stock: true, loyalty: true, broadcasts: true };
    expect(availableReports(all, false)).toEqual([
      "sales",
      "profit",
      "stock",
      "points",
      "broadcasts",
      "refusals",
    ]);
    expect(availableReports(all, true)).toEqual(["sales", "profit", "points", "refusals"]);
  });

  it("изменение: не к чему сравнивать — null, нулевое прошлое с ростом — null", () => {
    expect(delta({ key: "x", current: 5, previous: null })).toBeNull();
    expect(delta({ key: "x", current: 5, previous: 0 })).toBeNull();
    expect(delta({ key: "x", current: 150, previous: 100 })).toBe(50);
  });

  it("CSV: сводка и таблица, формулы в ячейках обезврежены", () => {
    const { csv, count } = reportCsv(
      {
        kind: "profit",
        days: 7,
        metrics: [{ key: "revenue", current: 100, previous: 50 }],
        table: { columns: ["product"], rows: [['=HYPERLINK("http://x")'], ["Торт"]] },
      },
      (k, key) => `${k}:${key}`,
      { metric: "M", current: "C", previous: "P", change: "D" },
    );
    expect(count).toBe(3);
    expect(csv).toContain("m:revenue;100;50;100");
    expect(csv).toContain("c:product");
    expect(csv).not.toMatch(/(^|;|\n)=HYPERLINK/);
    expect(csv).toContain("Торт");
  });
});
