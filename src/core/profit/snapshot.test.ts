import { describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock("@/lib/errors", () => ({ reportError: reported }));
import { ServerFailure } from "@/lib/server-failure";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { recordOrderEvent } from "@/core/orders/events";
import { saveCost } from "./cost";
import { loadSnapshots, parseSnapshot, snapshotOrderCost } from "./snapshot";

const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const P = "11111111-1111-4111-8111-111111111111";

function shop(modules: Record<string, boolean> = { profit: true }) {
  const db = fakeDb({
    unique: { app_settings: [["bot_id", "key"]], zernio_logs: [["event_id"]] },
  });
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_currency", value: "KZT" }];
  db.tables.zernio_logs = [];
  db.tables.products = [
    {
      id: P,
      bot_id: BOT,
      name: "Торт",
      price: 9000,
      currency: "KZT",
      is_active: true,
      sort_order: 0,
    },
  ];
  db.tables.product_variants = [
    { id: "v1", bot_id: BOT, product_id: P, name: "1 кг", price: 9000, sort_order: 0 },
    { id: "v2", bot_id: BOT, product_id: P, name: "2 кг", price: 17000, sort_order: 1 },
  ];
  db.tables.order_items = [
    {
      id: "i1",
      bot_id: BOT,
      order_id: 7,
      product_id: P,
      product_variant_id: "v2",
      quantity: 2,
      name_snapshot: "Торт",
      price_snapshot: 17000,
    },
    {
      id: "i2",
      bot_id: BOT,
      order_id: 7,
      product_id: P,
      product_variant_id: null,
      quantity: 1,
      name_snapshot: "Торт",
      price_snapshot: 9000,
    },
    {
      id: "i3",
      bot_id: BOT,
      order_id: 7,
      product_id: null,
      product_variant_id: null,
      quantity: 1,
      name_snapshot: "Удалён",
      price_snapshot: 100,
    },
  ];
  const ctx = { tenant: { id: BOT, modules, settings: {} }, db } as unknown as TenantContext;
  return { ctx, db };
}
const snapRow = (db: ReturnType<typeof shop>["db"], id = 7) =>
  db.tables.app_settings!.find((r) => r.key === `order_cost:${id}`);

describe("себестоимость в момент продажи", () => {
  it("снимок: вариант по названию, товар без варианта — цена товара, удалённый товар — null", async () => {
    const { ctx } = shop();
    await saveCost(ctx, P, { price: 4000, variants: { "2 кг": 7500 } });
    expect(await snapshotOrderCost(ctx, 7)).toBe(true);
    expect((await loadSnapshots(ctx, [7])).get(7)).toEqual({
      cur: "KZT",
      items: [
        { p: P, q: 2, c: 7500 },
        { p: P, q: 1, c: 4000 },
        { p: null, q: 1, c: null },
      ],
    });
  });

  it("id варианта обнулён пересохранением товара — вариант по названию позиции, не найден — «не задана», а не цена товара", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P, { price: 4000, variants: { "1 кг": 4000, "2 кг": 7000 } });
    const [a, b] = db.tables.order_items!;
    Object.assign(a!, { product_variant_id: null, name_snapshot: "Торт (2 кг)" });
    Object.assign(b!, { product_variant_id: null, name_snapshot: "Торт (3 кг)" });
    await snapshotOrderCost(ctx, 7);
    const items = (await loadSnapshots(ctx, [7])).get(7)!.items;
    expect(items[0]).toEqual({ p: P, q: 2, c: 7000 });
    expect(items[1]).toEqual({ p: P, q: 1, c: null });
  });

  it("цену закупки изменили после продажи — снимок прошлого заказа прежний", async () => {
    const { ctx } = shop();
    await saveCost(ctx, P, { price: 4000 });
    await snapshotOrderCost(ctx, 7);
    await saveCost(ctx, P, { price: 6000 });
    expect((await loadSnapshots(ctx, [7])).get(7)!.items[1]!.c).toBe(4000);
    // Повтор события оплаты — снимок не перезаписан.
    expect(await snapshotOrderCost(ctx, 7)).toBe(false);
    expect((await loadSnapshots(ctx, [7])).get(7)!.items[1]!.c).toBe(4000);
  });

  it("гонка: два одновременных события — снимок записан ровно один раз", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P, { price: 4000 });
    const r = await Promise.all([1, 2, 3, 4].map(() => snapshotOrderCost(ctx, 7)));
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(db.tables.app_settings!.filter((x) => x.key === "order_cost:7")).toHaveLength(1);
  });

  it("себестоимость не задана ни у одной позиции — снимок не пишется", async () => {
    const { ctx, db } = shop();
    expect(await snapshotOrderCost(ctx, 7)).toBe(false);
    expect(snapRow(db)).toBeUndefined();
    // Задали позже — следующее событие по заказу снимет её.
    await saveCost(ctx, P, { price: 4000 });
    expect(await snapshotOrderCost(ctx, 7)).toBe(true);
  });

  it("у части позиций себестоимости нет — в снимке null (не 0)", async () => {
    const { ctx } = shop();
    await saveCost(ctx, P, { variants: { "2 кг": 7500 } });
    await snapshotOrderCost(ctx, 7);
    expect((await loadSnapshots(ctx, [7])).get(7)!.items.map((i) => i.c)).toEqual([
      7500,
      null,
      null,
    ]);
  });

  it("без модуля снимка нет", async () => {
    const { ctx, db } = shop({});
    expect(await snapshotOrderCost(ctx, 7)).toBe(false);
    expect(snapRow(db)).toBeUndefined();
  });

  it("настоящий путь: событие оплаты и начало выдачи пишут снимок, прочие события — нет", async () => {
    const { ctx, db } = shop();
    await saveCost(ctx, P, { price: 4000 });
    await recordOrderEvent(ctx, 7, "placed", {});
    expect(snapRow(db)).toBeUndefined();
    await recordOrderEvent(ctx, 7, "payment", { amount: 1, currency: "KZT" }, "system");
    expect(parseSnapshot(String(snapRow(db)!.value))!.items[1]!.c).toBe(4000);
    await saveCost(ctx, P, { price: 5000 });
    await recordOrderEvent(ctx, 7, "delivery_started", {});
    expect(parseSnapshot(String(snapRow(db)!.value))!.items[1]!.c).toBe(4000);
  });

  it("сбой чтения позиций не ломает событие: снимка нет, заказ идёт дальше", async () => {
    const { ctx, db } = shop();
    const from = db.from.bind(db);
    db.from = (t: string) => {
      if (t === "order_items") throw new Error("база недоступна");
      return from(t);
    };
    await expect(recordOrderEvent(ctx, 7, "payment", {}, "system")).resolves.toBeUndefined();
    expect(snapRow(db)).toBeUndefined();
  });

  it("сбой чтения базы уходит в Sentry как ServerFailure с понятным текстом, а не как «Error»", async () => {
    for (const [table, text] of [
      ["app_settings", "Снимок себестоимости"],
      ["product_variants", "Варианты для себестоимости"],
    ] as const) {
      reported.mockClear();
      const { ctx, db } = shop();
      await saveCost(ctx, P, { price: 4000 });
      const from = db.from.bind(db);
      const bad = { data: null, error: { message: "boom" } };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "like", "order", "range"]) chain[m] = () => chain;
      chain.maybeSingle = async () => bad;
      chain.then = (ok: (v: unknown) => unknown) => ok(bad);
      let armed = false;
      db.from = (t: string) => {
        if (t === table && armed) return chain as never;
        return from(t);
      };
      armed = true;
      expect(await snapshotOrderCost(ctx, 7)).toBe(false);
      const err = reported.mock.calls[0]![0] as Error;
      expect(err).toBeInstanceOf(ServerFailure);
      expect(err.message).toContain(text);
    }
  });

  it("больше 200 заказов читаются кусками", async () => {
    const { ctx, db } = shop();
    db.maxIn = 200;
    for (let i = 1; i <= 450; i++)
      db.tables.app_settings!.push({
        bot_id: BOT,
        key: `order_cost:${1000 + i}`,
        value: JSON.stringify({ cur: "KZT", items: [{ p: P, q: 1, c: 1 }] }),
      });
    const ids = Array.from({ length: 450 }, (_, i) => 1001 + i);
    expect((await loadSnapshots(ctx, ids)).size).toBe(450);
  });
});
