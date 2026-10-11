import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFxProvider, resetPricingCache, setFxProvider } from "@/core/pricing/pricing";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { analytics } from "./analytics";

const BOT = "00000000-0000-0000-0000-000000000001";
const DAY = 86_400_000;
const ago = (d: number, h = 0) => new Date(Date.now() - d * DAY - h * 3_600_000).toISOString();

function ctxWith(db: ReturnType<typeof fakeDb>) {
  return {
    tenant: { id: BOT, modules: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
}

let nextId = 1;
function order(o: Record<string, unknown>) {
  return {
    id: nextId++,
    bot_id: BOT,
    total: 1000,
    paid_amount: null,
    currency: "KZT",
    status: "delivered",
    fulfillment_kind: "digital",
    platform: "telegram",
    telegram_id: 1,
    ...o,
  };
}

function dataset() {
  nextId = 1;
  const db = fakeDb({ maxRows: 1000 });
  db.tables.orders = [
    order({ created_at: ago(1), total: 5000, telegram_id: 10 }),
    order({ created_at: ago(2), total: 3000, telegram_id: 11, platform: "instagram" }),
    order({ created_at: ago(2, 3), total: 20, currency: "USD", telegram_id: 12 }),
    order({
      created_at: ago(3),
      total: 7000,
      status: "in_production",
      fulfillment_kind: "physical",
      paid_amount: 2000,
      telegram_id: 10,
    }),
    order({ created_at: ago(4), total: 9000, status: "awaiting_payment", telegram_id: 13 }),
    order({ created_at: ago(9), total: 4000, telegram_id: 14 }),
    order({ created_at: ago(10), total: 6000, telegram_id: 15, platform: "whatsapp" }),
  ];
  db.tables.order_items = [
    { order_id: 1, product_id: "p1", name_snapshot: "Торт", price_snapshot: 2500, quantity: 2 },
    { order_id: 2, product_id: "p2", name_snapshot: "Пирог", price_snapshot: 3000, quantity: 1 },
    { order_id: 4, product_id: "p1", name_snapshot: "Торт", price_snapshot: 3500, quantity: 2 },
  ];
  db.tables.bot_users = [
    { bot_id: BOT, user_key: "a", created_at: ago(1) },
    { bot_id: BOT, user_key: "b", created_at: ago(5) },
    { bot_id: BOT, user_key: "c", created_at: ago(11) },
  ];
  return db;
}

// Курс — не из сети: по умолчанию его нет (валюта без курса идёт отдельно), тест с курсом ставит свой.
beforeEach(() => {
  resetPricingCache();
  setFxProvider(() => Promise.reject(new Error("offline")));
});
afterEach(() => setFxProvider(defaultFxProvider));

describe("аналитика", () => {
  it("итоги, валюты, каналы, статусы и топ за период", async () => {
    const a = await analytics(ctxWith(dataset()), 7);
    expect(a.series).toHaveLength(7);
    expect(a.series.reduce((sum, p) => sum + p.orders, 0)).toBe(a.current.orders);
    expect(a.currency).toBe("KZT");
    expect(a.byCurrency).toEqual([
      { currency: "KZT", revenue: 10000, orders: 3, inBase: 10000 },
      { currency: "USD", revenue: 20, orders: 1, inBase: null },
    ]);
    expect(a.current).toEqual({
      revenue: 10000,
      orders: 3,
      avgCheck: 3333,
      customers: 2,
      buyers: 3,
    });
    expect(a.previous).toEqual({
      revenue: 10000,
      orders: 2,
      avgCheck: 5000,
      customers: 1,
      buyers: 2,
    });
    expect(a.delta).toEqual({
      revenue: 0,
      orders: 50,
      avgCheck: -33.3,
      customers: 100,
      buyers: 50,
    });
    expect(a.topProducts).toEqual([
      { name: "Торт", revenue: 7000, qty: 4, orders: 2 },
      { name: "Пирог", revenue: 3000, qty: 1, orders: 1 },
    ]);
    expect(a.byPlatform).toEqual([
      { platform: "telegram", orders: 2, revenue: 7000 },
      { platform: "instagram", orders: 1, revenue: 3000 },
    ]);
    expect(a.byStatus).toEqual([
      { status: "delivered", orders: 3 },
      { status: "awaiting_payment", orders: 1 },
      { status: "in_production", orders: 1 },
    ]);
  });

  it("другие валюты пересчитаны в ₸ по курсу: плитки, график, каналы и топ — одной суммой", async () => {
    // 1 $ = 500 ₸ = 80 ₽: 20 $ → 10 000 ₸, 800 ₽ → 5 000 ₸.
    setFxProvider(async () => ({ USD: 1, KZT: 500, RUB: 80 }));
    const db = dataset();
    db.tables.orders.push(
      order({ created_at: ago(1), total: 800, currency: "RUB", telegram_id: 16 }),
    );
    db.tables.order_items.push(
      { order_id: 3, product_id: "p3", name_snapshot: "Курс", price_snapshot: 20, quantity: 1 },
      { order_id: 8, product_id: "p1", name_snapshot: "Торт", price_snapshot: 800, quantity: 1 },
    );
    const a = await analytics(ctxWith(db), 7);
    expect(a.currency).toBe("KZT");
    expect(a.current).toMatchObject({ revenue: 25000, orders: 5 });
    expect(a.series.reduce((sum, p) => sum + p.revenue, 0)).toBe(25000);
    expect(a.byCurrency).toEqual([
      { currency: "KZT", revenue: 10000, orders: 3, inBase: 10000 },
      { currency: "RUB", revenue: 800, orders: 1, inBase: 5000 },
      { currency: "USD", revenue: 20, orders: 1, inBase: 10000 },
    ]);
    expect(a.topProducts).toEqual([
      { name: "Торт", revenue: 12000, qty: 5, orders: 3 },
      { name: "Курс", revenue: 10000, qty: 1, orders: 1 },
      { name: "Пирог", revenue: 3000, qty: 1, orders: 1 },
    ]);
    expect(a.byPlatform).toEqual([
      { platform: "telegram", orders: 4, revenue: 22000 },
      { platform: "instagram", orders: 1, revenue: 3000 },
    ]);
  });

  it("большой магазин: заказов и позиций больше 1000 — ничего не теряется", async () => {
    nextId = 1;
    const db = fakeDb({ maxRows: 1000 });
    db.tables.orders = Array.from({ length: 2500 }, (_, i) =>
      order({ created_at: ago(1, i % 20), total: 600, telegram_id: 1000 + i }),
    );
    // По 6 позиций на заказ: на кусок из 200 заказов — 1200 строк, больше потолка ответа.
    db.tables.order_items = db.tables.orders.flatMap((o) =>
      Array.from({ length: 6 }, (_, k) => ({
        id: `${String(o.id)}-${k}`,
        order_id: o.id,
        product_id: "p1",
        name_snapshot: "Открытка",
        price_snapshot: 100,
        quantity: 1,
      })),
    );
    db.tables.bot_users = Array.from({ length: 1500 }, (_, i) => ({
      bot_id: BOT,
      user_key: `u${i}`,
      created_at: ago(2),
    }));
    const a = await analytics(ctxWith(db), 7);
    expect(a.current).toMatchObject({
      revenue: 1_500_000,
      orders: 2500,
      buyers: 2500,
      customers: 1500,
    });
    expect(a.topProducts[0]).toMatchObject({ name: "Открытка", qty: 15_000 });
  });
});
