import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { decrementStock } from "@/core/fulfillment/fulfillment";
import {
  STOCKTAKE_KEY,
  cancelStocktake,
  confirmStocktake,
  discrepancies,
  listCountItems,
  loadStocktake,
  setCount,
  startStocktake,
} from "./stocktake";

const BOT = "00000000-0000-0000-0000-000000000001";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.products = [
    { id: A, bot_id: BOT, name: "Арбуз", stock_quantity: 10, fulfillment_kind: "physical" },
    { id: B, bot_id: BOT, name: "Банан", stock_quantity: 5, fulfillment_kind: "physical" },
    { id: C, bot_id: BOT, name: "Курс", stock_quantity: null, fulfillment_kind: "digital" },
    { id: D, bot_id: BOT, name: "Дыня", stock_quantity: 3, fulfillment_kind: "physical" },
  ];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { db, ctx };
}
const stock = (db: ReturnType<typeof setup>["db"], id: string) =>
  db.tables.products!.find((p) => p.id === id)!.stock_quantity;
const events = (db: ReturnType<typeof setup>["db"]) =>
  (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "stock.stocktake");

describe("инвентаризация", () => {
  it("расхождение в плюс и в минус пишется разницей и событием stock.stocktake", async () => {
    const { ctx, db } = setup();
    const s = await startStocktake(ctx, "admin:ann");
    await setCount(ctx, s.id, A, 12); // +2
    await setCount(ctx, s.id, B, 3); // −2
    await setCount(ctx, s.id, D, 3); // без расхождения
    const diffs = await discrepancies(ctx, (await loadStocktake(ctx))!);
    expect(diffs.map((d) => [d.name, d.diff])).toEqual([
      ["Арбуз", 2],
      ["Банан", -2],
    ]);
    const done = await confirmStocktake(ctx, s.id, "admin:ann");
    expect(done.status).toBe("posted");
    expect(stock(db, A)).toBe(12);
    expect(stock(db, B)).toBe(3);
    expect(stock(db, D)).toBe(3);
    expect(events(db)).toHaveLength(2);
    expect(events(db)[0]!.payload).toMatchObject({
      product_id: A,
      from: 10,
      to: 12,
      expected: 10,
      counted: 12,
      actor: "admin:ann",
    });
  });

  it("заказ между вводом и подтверждением не теряется: разница от остатка на момент ввода", async () => {
    const { ctx, db } = setup();
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 8); // числилось 10, насчитали 8: −2
    // Пока шёл подсчёт, заказ забрал 3 штуки.
    expect(await decrementStock(ctx, A, 3)).toBe(true);
    expect(stock(db, A)).toBe(7);
    await confirmStocktake(ctx, s.id, "x");
    // 7 − 2 = 5, а не «записать 8» (воскресили бы проданные 3).
    expect(stock(db, A)).toBe(5);
    expect(events(db)[0]!.payload).toMatchObject({ from: 7, to: 5, expected: 10, counted: 8 });
  });

  it("заказ во время самого подтверждения не теряется", async () => {
    const { ctx, db } = setup();
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 14); // +4
    const [, a, b] = await Promise.all([
      confirmStocktake(ctx, s.id, "x"),
      decrementStock(ctx, A, 1),
      decrementStock(ctx, A, 2),
    ]);
    expect([a, b]).toEqual([true, true]);
    expect(stock(db, A)).toBe(10 + 4 - 3);
  });

  it("если заказы продали больше, чем недосчитали, остаток 0, а не минус", async () => {
    const { ctx, db } = setup();
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 4); // −6
    await decrementStock(ctx, A, 8); // осталось 2
    await confirmStocktake(ctx, s.id, "x");
    expect(stock(db, A)).toBe(0);
    expect(events(db)[0]!.payload).toMatchObject({ from: 2, to: 0, clamped: true });
  });

  it("повторное подтверждение — один раз, в том числе параллельное", async () => {
    const { ctx, db } = setup();
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 15);
    const r = await Promise.allSettled([
      confirmStocktake(ctx, s.id, "x"),
      confirmStocktake(ctx, s.id, "x"),
      confirmStocktake(ctx, s.id, "x"),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(stock(db, A)).toBe(15);
    await expect(confirmStocktake(ctx, s.id, "x")).rejects.toMatchObject({
      key: "err.stock.stocktakePosted",
    });
    expect(stock(db, A)).toBe(15);
    expect(events(db)).toHaveLength(1);
  });

  it("после подтверждения ввод закрыт, начать можно новую", async () => {
    const { ctx } = setup();
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 11);
    await confirmStocktake(ctx, s.id, "x");
    await expect(setCount(ctx, s.id, A, 1)).rejects.toMatchObject({
      key: "err.stock.stocktakeClosed",
    });
    const n = await startStocktake(ctx, "x");
    expect(n.id).not.toBe(s.id);
    expect(n.status).toBe("draft");
  });

  it("начать при открытой — вернуть открытую", async () => {
    const { ctx } = setup();
    const s = await startStocktake(ctx, "x");
    const again = await startStocktake(ctx, "y");
    expect(again.id).toBe(s.id);
    const both = await Promise.all([startStocktake(ctx, "a"), startStocktake(ctx, "b")]);
    expect(new Set(both.map((x) => x.id)).size).toBe(1);
  });

  it("цифровой и без учёта остатка не считаются; цифры в границах", async () => {
    const { ctx } = setup();
    const s = await startStocktake(ctx, "x");
    await expect(setCount(ctx, s.id, C, 1)).rejects.toMatchObject({ key: "err.stock.untracked" });
    await expect(setCount(ctx, s.id, A, -1)).rejects.toMatchObject({ key: "err.stock.badCount" });
    await expect(setCount(ctx, s.id, A, 1.5)).rejects.toMatchObject({ key: "err.stock.badCount" });
    await expect(
      setCount(ctx, s.id, "55555555-5555-4555-8555-555555555555", 1),
    ).rejects.toMatchObject({ key: "err.stock.receiptProduct" });
  });

  it("ввод можно стереть, ноль — настоящий ответ", async () => {
    const { ctx, db } = setup();
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 0);
    expect((await loadStocktake(ctx))!.lines[A]).toMatchObject({ counted: 0, expected: 10 });
    await setCount(ctx, s.id, A, null);
    expect((await loadStocktake(ctx))!.lines[A]).toBeUndefined();
    await setCount(ctx, s.id, B, 0);
    await confirmStocktake(ctx, s.id, "x");
    expect(stock(db, B)).toBe(0);
  });

  it("отмена: остатки не меняются, подтвердить нельзя", async () => {
    const { ctx, db } = setup();
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 99);
    await cancelStocktake(ctx, s.id);
    await expect(confirmStocktake(ctx, s.id, "x")).rejects.toMatchObject({
      key: "err.stock.stocktakeClosed",
    });
    expect(stock(db, A)).toBe(10);
    expect(await loadStocktake(ctx)).toBeNull();
  });

  it("товар, у которого остаток перестали вести, пропускается", async () => {
    const { ctx, db } = setup();
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 12);
    await setCount(ctx, s.id, B, 6);
    db.tables.products!.find((p) => p.id === A)!.stock_quantity = null;
    const done = await confirmStocktake(ctx, s.id, "x");
    expect(done.lines[A]!.state).toBe("skipped");
    expect(stock(db, A)).toBeNull();
    expect(stock(db, B)).toBe(6);
  });

  it("оборванное подтверждение продолжается с невыполненных строк", async () => {
    const { ctx, db } = setup();
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 12);
    await setCount(ctx, s.id, B, 7);
    const row = db.tables.app_settings!.find((r) => r.key === STOCKTAKE_KEY)!;
    const doc = JSON.parse(row.value as string);
    doc.status = "posting";
    doc.claim = "dead";
    doc.postingAt = "2020-01-01T00:00:00.000Z";
    doc.lines[A] = { ...doc.lines[A], state: "done", from: 10, to: 12 };
    row.value = JSON.stringify(doc);
    db.tables.products!.find((p) => p.id === A)!.stock_quantity = 12;
    await confirmStocktake(ctx, s.id, "x");
    expect(stock(db, A)).toBe(12);
    expect(stock(db, B)).toBe(7);
  });

  it("список товаров: постранично без обрезки, цифровые не показываются, ввод виден", async () => {
    const { ctx, db } = setup();
    for (let i = 0; i < 120; i++)
      db.tables.products!.push({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        bot_id: BOT,
        name: `Товар ${String(i).padStart(3, "0")}`,
        stock_quantity: i,
        fulfillment_kind: "physical",
      });
    const s = await startStocktake(ctx, "x");
    await setCount(ctx, s.id, A, 9);
    const doc = await loadStocktake(ctx);
    const p0 = await listCountItems(ctx, doc, { page: 0 });
    const p1 = await listCountItems(ctx, doc, { page: 1 });
    const p2 = await listCountItems(ctx, doc, { page: 2 });
    expect(p0.total).toBe(123);
    const ids = [...p0.items, ...p1.items, ...p2.items].map((i) => i.id);
    expect(ids).toHaveLength(123);
    expect(new Set(ids).size).toBe(123);
    expect(ids).not.toContain(C);
    expect([...p0.items, ...p1.items, ...p2.items].find((i) => i.id === A)).toMatchObject({
      counted: 9,
      expected: 10,
      stock: 10,
    });
  });
});
