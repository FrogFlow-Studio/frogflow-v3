import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { GIFT_WRAP_MARK } from "@/core/orders/gift-wrap";
import { bundleGiftStats } from "./bundles";
import { bundleGiftResults } from "./bundles.server";

const BOT = "11111111-1111-1111-1111-111111111111";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P1 = "11111111-aaaa-4aaa-8aaa-111111111111";
const P2 = "22222222-aaaa-4aaa-8aaa-222222222222";
const NOW = new Date("2026-10-04T12:00:00Z");

const order = (id: number, status: string, over: object = {}) => ({
  id,
  created_at: "2026-10-01T10:00:00Z",
  status,
  currency: "KZT",
  fulfillment_kind: "physical",
  ...over,
});

describe("итоги наборов и подарков: чистый подсчёт", () => {
  const bundles = new Map([[B, "Набор «Уход»"]]);
  const savingPerUnit = new Map([[B, { currency: "KZT", amount: 300 }]]);
  it("считаются только оплаченные статусы: неоплаченный, отклонённый и отменённый — нет", () => {
    const orders = new Map(
      [
        order(1, "delivered"),
        order(2, "pending"),
        order(3, "rejected"),
        order(4, "cancelled"),
        order(5, "accepted"),
      ].map((o) => [o.id, o]),
    );
    const lines = [1, 2, 3, 4, 5].map((id) => ({
      order_id: id,
      product_id: B,
      name_snapshot: "Набор",
      quantity: 2,
      price_snapshot: 1000,
    }));
    const r = bundleGiftStats({
      orders,
      lines,
      giftOrderIds: new Set([1, 2, 3]),
      bundles,
      savingPerUnit,
    });
    expect(r.bundles).toMatchObject({
      orders: 2,
      units: 4,
      revenue: { KZT: 4000 },
      saving: { KZT: 1200 },
    });
    expect(r.gifts).toMatchObject({ orders: 2, gifts: 1 });
    expect(r.bundles.rows).toEqual([
      { id: B, name: "Набор «Уход»", units: 4, revenue: { KZT: 4000 }, saving: { KZT: 1200 } },
    ]);
  });

  it("упаковка — выручка отдельной строкой, а не товар; набор не дешевле — выгода ноль", () => {
    const orders = new Map([[1, order(1, "delivered")]]);
    const lines = [
      { order_id: 1, product_id: B, quantity: 1, price_snapshot: 1000 },
      {
        order_id: 1,
        product_id: null,
        name_snapshot: `${GIFT_WRAP_MARK}Упаковка`,
        quantity: 1,
        price_snapshot: 500,
      },
    ];
    const r = bundleGiftStats({
      orders,
      lines,
      giftOrderIds: new Set([1]),
      bundles,
      savingPerUnit: new Map([[B, { currency: "KZT", amount: -50 }]]),
    });
    expect(r.gifts).toMatchObject({ wrapOrders: 1, wrapRevenue: { KZT: 500 } });
    expect(r.bundles).toMatchObject({ units: 1, revenue: { KZT: 1000 }, saving: {} });
  });
});

describe("итоги наборов и подарков: из базы", () => {
  function setup(withModule = true) {
    const db = fakeDb();
    db.tables.app_settings = [
      {
        bot_id: BOT,
        key: `bundle:${B}`,
        value: JSON.stringify({
          items: [
            { p: P1, q: 1 },
            { p: P2, q: 1 },
          ],
        }),
      },
    ];
    const prod = (id: string, name: string, price: number) => ({
      id,
      name,
      price,
      currency: "KZT",
      is_active: true,
      fulfillment_kind: "physical",
      country_prices: {},
      category_ids: [],
      product_variants: [],
    });
    db.tables.products = [
      prod(B, "Набор «Уход»", 1500),
      prod(P1, "Шампунь", 1000),
      prod(P2, "Бальзам", 800),
    ];
    db.tables.orders = [
      order(1, "delivered", { bot_id: BOT }),
      order(2, "pending", { bot_id: BOT }),
      order(3, "delivered", { bot_id: BOT, created_at: "2026-08-01T10:00:00Z" }),
    ];
    db.tables.order_items = [
      {
        id: "i1",
        order_id: 1,
        product_id: B,
        name_snapshot: "Набор",
        quantity: 2,
        price_snapshot: 1500,
      },
      {
        id: "i2",
        order_id: 2,
        product_id: B,
        name_snapshot: "Набор",
        quantity: 9,
        price_snapshot: 1500,
      },
      {
        id: "i3",
        order_id: 3,
        product_id: B,
        name_snapshot: "Набор",
        quantity: 5,
        price_snapshot: 1500,
      },
    ];
    db.tables.zernio_logs = [
      {
        id: "z1",
        event_id: "order:1:gift:once",
        event_type: "order.gift",
        status: "event",
        created_at: "2026-10-01T10:00:01Z",
        payload: {},
      },
      {
        id: "z2",
        event_id: "order:2:gift:once",
        event_type: "order.gift",
        status: "event",
        created_at: "2026-10-01T10:00:01Z",
        payload: {},
      },
    ];
    const ctx = {
      tenant: { id: BOT, modules: { bundles: withModule } },
      db,
    } as unknown as TenantContext;
    return ctx;
  }

  it("за период: оплаченный заказ с набором и подарком, выгода по ценам состава", async () => {
    const r = await bundleGiftResults(setup(), 30, NOW);
    // Набор 1500 вместо 1000 + 800: выгода 300 за штуку, две штуки.
    expect(r!.bundles).toMatchObject({
      orders: 1,
      units: 2,
      revenue: { KZT: 3000 },
      saving: { KZT: 600 },
    });
    expect(r!.bundles.rows[0]!.name).toBe("Набор «Уход»");
    // Подарок неоплаченного заказа и заказ вне периода в долю не входят.
    expect(r!.gifts).toMatchObject({ orders: 1, gifts: 1 });
  });

  it("без модуля наборов — блока нет", async () => {
    expect(await bundleGiftResults(setup(false), 30, NOW)).toBeNull();
  });
});
