import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { decrementStock } from "@/core/fulfillment/fulfillment";
import { buildProfit } from "@/core/profit/report";
import { listWriteoffs, parseWriteoff, writeOff, writeoffTotals } from "./writeoff";

const BOT = "00000000-0000-0000-0000-000000000001";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function setup(cost: string | null = JSON.stringify({ p: 100, v: {}, cur: "KZT" })) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_currency", value: "KZT" }];
  if (cost) db.tables.app_settings.push({ bot_id: BOT, key: `cost:${P1}`, value: cost });
  db.tables.products = [
    { id: P1, bot_id: BOT, name: "Торт", stock_quantity: 10, fulfillment_kind: "physical" },
    { id: P2, bot_id: BOT, name: "Книга", stock_quantity: null, fulfillment_kind: "physical" },
  ];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { db, ctx };
}
/** Настоящая база ставит created_at сама; в памяти — проставляем. */
const stamp = (db: ReturnType<typeof setup>["db"]) => {
  for (const r of db.tables.zernio_logs ?? []) r.created_at ??= "2026-10-01T00:00:00Z";
};
const stock = (db: ReturnType<typeof setup>["db"]) =>
  db.tables.products!.find((p) => p.id === P1)!.stock_quantity;

describe("списание", () => {
  it("уменьшает остаток и пишет событие с причиной, комментарием и себестоимостью", async () => {
    const { ctx, db } = setup();
    const r = await writeOff(
      ctx,
      { productId: P1, qty: 3, reason: "defect", comment: " треснул " },
      "admin:ann",
    );
    expect(r).toMatchObject({ from: 10, to: 7, unitCost: 100, currency: "KZT" });
    expect(stock(db)).toBe(7);
    const ev = db.tables.zernio_logs!.filter((x) => x.event_type === "stock.writeoff");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({
      product_id: P1,
      from: 10,
      to: 7,
      writeoff_reason: "defect",
      comment: "треснул",
      unit_cost: 100,
      currency: "KZT",
      actor: "admin:ann",
    });
  });

  it("больше остатка — отказ с сообщением, остаток и журнал целы", async () => {
    const { ctx, db } = setup();
    await expect(
      writeOff(ctx, { productId: P1, qty: 11, reason: "loss" }, "x"),
    ).rejects.toMatchObject({
      key: "err.stock.writeoffTooMuch",
      message: "Нельзя списать 11 шт.: на складе 10.",
    });
    expect(stock(db)).toBe(10);
    expect(db.tables.zernio_logs ?? []).toHaveLength(0);
  });

  it("списать ровно остаток можно; ноль, дробь и неизвестная причина — отказ", async () => {
    const { ctx, db } = setup();
    await writeOff(ctx, { productId: P1, qty: 10, reason: "own" }, "x");
    expect(stock(db)).toBe(0);
    await expect(
      writeOff(ctx, { productId: P1, qty: 1, reason: "own" }, "x"),
    ).rejects.toMatchObject({ key: "err.stock.writeoffTooMuch" });
    await expect(
      writeOff(ctx, { productId: P1, qty: 0, reason: "own" }, "x"),
    ).rejects.toMatchObject({ key: "err.stock.badQty" });
    await expect(
      writeOff(ctx, { productId: P1, qty: 1.5, reason: "own" }, "x"),
    ).rejects.toMatchObject({ key: "err.stock.badQty" });
    await expect(
      writeOff(ctx, { productId: P1, qty: 1, reason: "xx" as never }, "x"),
    ).rejects.toMatchObject({ key: "err.stock.writeoffReason" });
  });

  it("товар без учёта остатка и неизвестный — отказ", async () => {
    const { ctx } = setup();
    await expect(
      writeOff(ctx, { productId: P2, qty: 1, reason: "own" }, "x"),
    ).rejects.toMatchObject({ key: "err.stock.untracked" });
    await expect(
      writeOff(
        ctx,
        { productId: "33333333-3333-4333-8333-333333333333", qty: 1, reason: "own" },
        "x",
      ),
    ).rejects.toMatchObject({ key: "err.stock.receiptProduct" });
  });

  it("заказ во время списания не теряется", async () => {
    const { ctx, db } = setup();
    const results = await Promise.allSettled([
      writeOff(ctx, { productId: P1, qty: 4, reason: "loss" }, "x"),
      decrementStock(ctx, P1, 2),
      decrementStock(ctx, P1, 3),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(stock(db)).toBe(1);
  });

  it("убыток считается по себестоимости на момент списания, а не по сегодняшней", async () => {
    const { ctx, db } = setup();
    await writeOff(ctx, { productId: P1, qty: 2, reason: "defect" }, "x");
    // Себестоимость потом выросла — прошлое списание не пересчитывается.
    db.tables.app_settings!.find((r) => r.key === `cost:${P1}`)!.value = JSON.stringify({
      p: 500,
      v: {},
      cur: "KZT",
    });
    await writeOff(ctx, { productId: P1, qty: 1, reason: "defect" }, "x");
    stamp(db);
    const t = await writeoffTotals(ctx, "2000-01-01T00:00:00Z", "KZT");
    expect(t).toEqual({ count: 2, qty: 3, loss: 2 * 100 + 1 * 500, unknownQty: 0 });
  });

  it("без себестоимости — штуки считаются, деньги нет", async () => {
    const { ctx, db } = setup(null);
    const r = await writeOff(ctx, { productId: P1, qty: 2, reason: "own" }, "x");
    stamp(db);
    expect(r.unitCost).toBeNull();
    expect(await writeoffTotals(ctx, "2000-01-01T00:00:00Z", "KZT")).toEqual({
      count: 1,
      qty: 2,
      loss: 0,
      unknownQty: 2,
    });
  });

  it("период: списания вне периода не входят", async () => {
    const { ctx, db } = setup();
    await writeOff(ctx, { productId: P1, qty: 2, reason: "defect" }, "x");
    db.tables.zernio_logs![0]!.created_at = "2026-01-01T00:00:00Z";
    expect(
      (await writeoffTotals(ctx, "2000-01-01T00:00:00Z", "KZT", (iso) => iso >= "2026-06-01"))
        .count,
    ).toBe(0);
    expect((await writeoffTotals(ctx, "2000-01-01T00:00:00Z", "KZT")).count).toBe(1);
  });

  it("список списаний: свежие сверху, постранично без обрезки, с названием товара", async () => {
    const { ctx } = setup();
    for (let i = 0; i < 5; i++) await writeOff(ctx, { productId: P1, qty: 1, reason: "loss" }, "x");
    const a = await listWriteoffs(ctx, { page: 0, pageSize: 2 });
    const b = await listWriteoffs(ctx, { page: 1, pageSize: 2 });
    const c = await listWriteoffs(ctx, { page: 2, pageSize: 2 });
    expect(a.total).toBe(5);
    expect([a, b, c].flatMap((p) => p.entries).length).toBe(5);
    expect(new Set([a, b, c].flatMap((p) => p.entries.map((e) => e.id))).size).toBe(5);
    expect(a.entries[0]).toMatchObject({ name: "Торт", qty: 1, reason: "loss" });
  });

  it("чужое событие не читается как списание", () => {
    expect(
      parseWriteoff({ id: "1", created_at: "x", payload: { product_id: P1, from: 3, to: 5 } }),
    ).toBeNull();
    expect(parseWriteoff({ id: "1", created_at: "x", payload: null })).toBeNull();
  });
});

describe("строка «Списания» в прибыли", () => {
  it("отчёт без склада не несёт списаний", () => {
    const rep = buildProfit({
      days: 7,
      currency: "KZT",
      now: new Date("2026-10-04T10:00:00Z"),
      tz: "Asia/Almaty",
      orders: [],
      items: new Map(),
      snapshots: new Map(),
      costs: new Map(),
      variantNames: new Map(),
      refunds: new Map(),
    });
    expect(rep.writeoffs).toBeNull();
  });
});
