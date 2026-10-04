import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { analytics } from "@/core/analytics/analytics";
import { saveCost } from "./cost";
import { snapshotOrderCost } from "./snapshot";
import { profitReport } from "./report";

const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

function shop() {
  const db = fakeDb({
    maxRows: 1000,
    unique: { app_settings: [["bot_id", "key"]], zernio_logs: [["event_id"]] },
  });
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_currency", value: "KZT" }];
  db.tables.zernio_logs = [];
  db.tables.bot_users = [];
  db.tables.products = [
    {
      id: P1,
      bot_id: BOT,
      name: "Торт",
      price: 5000,
      currency: "KZT",
      is_active: true,
      sort_order: 0,
    },
    {
      id: P2,
      bot_id: BOT,
      name: "Пирог",
      price: 3000,
      currency: "KZT",
      is_active: true,
      sort_order: 1,
    },
  ];
  db.tables.product_variants = [
    { id: "v1", bot_id: BOT, product_id: P1, name: "1 кг", price: 5000, sort_order: 0 },
  ];
  db.tables.orders = [
    {
      id: 1,
      bot_id: BOT,
      created_at: ago(1),
      total: 10000,
      paid_amount: null,
      currency: "KZT",
      status: "delivered",
      fulfillment_kind: "digital",
      platform: "telegram",
      telegram_id: 1,
    },
    {
      id: 2,
      bot_id: BOT,
      created_at: ago(2),
      total: 3000,
      paid_amount: null,
      currency: "KZT",
      status: "delivered",
      fulfillment_kind: "digital",
      platform: "telegram",
      telegram_id: 2,
    },
    {
      id: 3,
      bot_id: BOT,
      created_at: ago(2),
      total: 20,
      paid_amount: null,
      currency: "USD",
      status: "delivered",
      fulfillment_kind: "digital",
      platform: "telegram",
      telegram_id: 3,
    },
    {
      id: 4,
      bot_id: BOT,
      created_at: ago(3),
      total: 9000,
      paid_amount: null,
      currency: "KZT",
      status: "awaiting_payment",
      fulfillment_kind: "digital",
      platform: "telegram",
      telegram_id: 4,
    },
  ];
  db.tables.order_items = [
    {
      id: "a",
      bot_id: BOT,
      order_id: 1,
      product_id: P1,
      product_variant_id: "v1",
      name_snapshot: "Торт",
      price_snapshot: 5000,
      quantity: 2,
    },
    {
      id: "b",
      bot_id: BOT,
      order_id: 2,
      product_id: P2,
      product_variant_id: null,
      name_snapshot: "Пирог",
      price_snapshot: 3000,
      quantity: 1,
    },
    {
      id: "c",
      bot_id: BOT,
      order_id: 3,
      product_id: P2,
      product_variant_id: null,
      name_snapshot: "Пирог",
      price_snapshot: 20,
      quantity: 1,
    },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { profit: true }, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}
const refund = (db: ReturnType<typeof shop>["db"], orderId: number, amount: number, extra = {}) =>
  db.tables.zernio_logs!.push({
    id: `r${orderId}${amount}`,
    bot_id: BOT,
    event_id: `order:${orderId}:refund:n0`,
    event_type: "order.refund",
    status: "event",
    created_at: ago(0),
    payload: { order_id: orderId, amount, currency: "KZT", ...extra },
  });

describe("прибыль в аналитике", () => {
  it("выручка сходится с аналитикой, прибыль — по товарам с себестоимостью", async () => {
    const { ctx } = shop();
    await saveCost(ctx, P1, { price: 3000 });
    await saveCost(ctx, P2, { price: 1000 });
    const p = await profitReport(ctx, 30);
    const a = await analytics(ctx, 30);
    expect(p.revenue).toBe(a.current.revenue);
    expect(p.orders).toBe(a.current.orders);
    expect(p.cost).toBe(2 * 3000 + 1000);
    expect(p.profit).toBe(13000 - 7000);
    expect(p.margin).toBeCloseTo(6000 / 13000);
    expect(p.unknown).toEqual({ items: 0, revenue: 0 });
    expect(p.products.map((x) => [x.name, x.revenue, x.cost, x.profit])).toEqual([
      ["Торт", 10000, 6000, 4000],
      ["Пирог", 3000, 1000, 2000],
    ]);
  });

  it("товар без себестоимости — отдельной строкой, прибыль по нему не выдумывается", async () => {
    const { ctx } = shop();
    await saveCost(ctx, P1, { price: 3000 });
    const p = await profitReport(ctx, 30);
    expect(p.unknown).toEqual({ items: 1, revenue: 3000 });
    expect(p.revenue).toBe(13000);
    expect(p.cost).toBe(6000);
    expect(p.profit).toBe(4000);
    expect(p.margin).toBeCloseTo(0.4);
    expect(p.products.find((x) => x.name === "Пирог")).toMatchObject({
      profit: 0,
      unknownQty: 1,
      unknownRevenue: 3000,
    });
  });

  it("себестоимости нет нигде: прибыли и маржи нет, выручка вся в «не задана»", async () => {
    const { ctx } = shop();
    const p = await profitReport(ctx, 30);
    expect(p.cost).toBe(0);
    expect(p.profit).toBe(0);
    expect(p.margin).toBeNull();
    expect(p.unknown).toEqual({ items: 2, revenue: 13000 });
  });

  it("две валюты не складываются: чужая валюта — отдельной строкой без прибыли", async () => {
    const { ctx } = shop();
    await saveCost(ctx, P2, { price: 1000 });
    const p = await profitReport(ctx, 30);
    expect(p.otherCurrencies).toEqual([{ currency: "USD", revenue: 20, orders: 1 }]);
    expect(p.revenue).toBe(13000);
    expect(p.products.find((x) => x.name === "Пирог")!.qty).toBe(1);
  });

  it("частичный возврат: выручка уменьшается, без склада себестоимость прежняя", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P1, { price: 3000 });
    refund(db, 1, 4000);
    const p = await profitReport(ctx, 30);
    const a = await analytics(ctx, 30);
    expect(p.revenue).toBe(9000);
    expect(p.revenue).toBe(a.current.revenue);
    expect(p.cost).toBe(6000);
    expect(p.profit).toBe(0); // 6000 выручки по Торту после возврата − 6000 себестоимости
  });

  it("возврат на склад снимает себестоимость в той же доле", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P1, { price: 3000 });
    refund(db, 1, 10000, { restocked: 2 });
    const p = await profitReport(ctx, 30);
    expect(p.revenue).toBe(3000);
    expect(p.cost).toBe(0);
  });

  it("цену закупки изменили после продажи: снимок держит прошлое, без снимка — «по текущей»", async () => {
    const { ctx } = shop();
    await saveCost(ctx, P1, { price: 3000 });
    await snapshotOrderCost(ctx, 1);
    await saveCost(ctx, P1, { price: 4500 });
    const p = await profitReport(ctx, 30);
    expect(p.cost).toBe(2 * 3000);
    expect(p.fromCurrent.items).toBe(0);
    // Заказ 2 без снимка: Пирог — себестоимость задали уже после продажи.
    await saveCost(ctx, P2, { price: 1000 });
    const q = await profitReport(ctx, 30);
    expect(q.cost).toBe(6000 + 1000);
    expect(q.fromCurrent.items).toBe(1);
  });

  it("вариант: своя себестоимость; id варианта пропал после пересохранения товара — не берём цену товара", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P1, { price: 3000, variants: { "1 кг": 2000 } });
    await saveCost(ctx, P2, { price: 1000 });
    expect((await profitReport(ctx, 30)).cost).toBe(2 * 2000 + 1000);
    db.tables.product_variants = [];
    const p = await profitReport(ctx, 30);
    expect(p.unknown.items).toBe(1);
    expect(p.cost).toBe(1000);
  });

  it("скидка и доставка: выручка заказа раскладывается по позициям, сумма сходится", async () => {
    const { ctx, db } = shop();
    db.tables.orders![0]!.total = 9000; // скидка 1000 на заказ
    await saveCost(ctx, P1, { price: 3000 });
    const p = await profitReport(ctx, 30);
    expect(p.products.find((x) => x.name === "Торт")!.revenue).toBe(9000);
    expect(p.profit).toBe(3000);
  });

  it("больше тысячи заказов читаются постранично", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P2, { price: 1000 });
    for (let i = 0; i < 1300; i++) {
      const id = 100 + i;
      db.tables.orders!.push({
        id,
        bot_id: BOT,
        created_at: ago(1),
        total: 3000,
        paid_amount: null,
        currency: "KZT",
        status: "delivered",
        fulfillment_kind: "digital",
        platform: "telegram",
        telegram_id: 1,
      });
      db.tables.order_items!.push({
        id: `x${id}`,
        bot_id: BOT,
        order_id: id,
        product_id: P2,
        product_variant_id: null,
        name_snapshot: "Пирог",
        price_snapshot: 3000,
        quantity: 1,
      });
    }
    const p = await profitReport(ctx, 30);
    expect(p.orders).toBe(2 + 1300);
    expect(p.revenue).toBe(13000 + 1300 * 3000);
  });
});
