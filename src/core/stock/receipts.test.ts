import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { decrementStock } from "@/core/fulfillment/fulfillment";
import { parseCost } from "@/core/profit/cost";
import {
  createReceipt,
  deleteReceipt,
  listReceipts,
  loadReceipt,
  postReceipt,
  receiptKey,
  updateReceipt,
  weightedCost,
} from "./receipts";

const BOT = "00000000-0000-0000-0000-000000000001";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_currency", value: "KZT" }];
  db.tables.products = [
    { id: P1, bot_id: BOT, stock_quantity: 10, fulfillment_kind: "physical" },
    { id: P2, bot_id: BOT, stock_quantity: 0, fulfillment_kind: "physical" },
    { id: P3, bot_id: BOT, stock_quantity: null, fulfillment_kind: "physical" },
  ];
  db.tables.product_variants = [
    { id: "v1", bot_id: BOT, product_id: P1, name: "Большой", price: 1 },
  ];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { db, ctx };
}

const stockOf = (db: ReturnType<typeof setup>["db"], id: string) =>
  db.tables.products!.find((p) => p.id === id)!.stock_quantity;
const costOf = (db: ReturnType<typeof setup>["db"], id: string) =>
  parseCost(db.tables.app_settings!.find((r) => r.key === `cost:${id}`)?.value as string);
const events = (db: ReturnType<typeof setup>["db"]) =>
  (db.tables.zernio_logs ?? []).filter((r) => String(r.event_type).startsWith("stock."));

describe("приход товара", () => {
  it("проведение прибавляет остаток и пишет событие stock.receipt с номером прихода", async () => {
    const { ctx, db } = setup();
    const SUP = "55555555-5555-4555-8555-555555555555";
    const d = await createReceipt(
      ctx,
      {
        supplierId: SUP,
        lines: [{ productId: P1, qty: 5, price: 100 }],
        updateCost: false,
      },
      "admin:ann",
    );
    expect(d).toMatchObject({ no: 1, status: "draft" });
    expect(stockOf(db, P1)).toBe(10);
    const done = await postReceipt(ctx, d.id, "admin:ann");
    expect(done.status).toBe("posted");
    expect(done.lines[0]).toMatchObject({ state: "done", from: 10, to: 15 });
    expect(stockOf(db, P1)).toBe(15);
    expect(events(db)).toHaveLength(1);
    expect(events(db)[0]).toMatchObject({ event_type: "stock.receipt" });
    expect(events(db)[0]!.payload).toMatchObject({
      product_id: P1,
      from: 10,
      to: 15,
      receipt_no: 1,
      actor: "admin:ann",
      supplier_id: SUP,
    });
    expect(costOf(db, P1)).toBeNull();
  });

  it("номера идут подряд", async () => {
    const { ctx } = setup();
    const a = await createReceipt(
      ctx,
      { supplierId: null, lines: [{ productId: P1, qty: 1, price: 1 }], updateCost: false },
      "x",
    );
    const b = await createReceipt(
      ctx,
      { supplierId: null, lines: [{ productId: P1, qty: 1, price: 1 }], updateCost: false },
      "x",
    );
    expect([a.no, b.no]).toEqual([1, 2]);
    expect((await listReceipts(ctx)).map((r) => r.no)).toEqual([2, 1]);
  });

  it("двойное проведение — один раз, в том числе параллельное", async () => {
    const { ctx, db } = setup();
    const d = await createReceipt(
      ctx,
      { supplierId: null, lines: [{ productId: P1, qty: 5, price: 1 }], updateCost: false },
      "x",
    );
    const r = await Promise.allSettled([
      postReceipt(ctx, d.id, "a"),
      postReceipt(ctx, d.id, "b"),
      postReceipt(ctx, d.id, "c"),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(stockOf(db, P1)).toBe(15);
    expect(events(db)).toHaveLength(1);
    // И повтор после проведения.
    await expect(postReceipt(ctx, d.id, "a")).rejects.toMatchObject({
      key: "err.stock.receiptPosted",
    });
    expect(stockOf(db, P1)).toBe(15);
  });

  it("заказ во время проведения не теряет списание", async () => {
    const { ctx, db } = setup();
    const d = await createReceipt(
      ctx,
      { supplierId: null, lines: [{ productId: P1, qty: 5, price: 1 }], updateCost: false },
      "x",
    );
    const sunk: unknown[] = [];
    const [, a, b, c] = await Promise.all([
      postReceipt(ctx, d.id, "x"),
      decrementStock(ctx, P1, 1, sunk as never),
      decrementStock(ctx, P1, 2, sunk as never),
      decrementStock(ctx, P1, 3, sunk as never),
    ]);
    expect([a, b, c]).toEqual([true, true, true]);
    // 10 + 5 − (1 + 2 + 3)
    expect(stockOf(db, P1)).toBe(9);
  });

  it("средневзвешенная себестоимость", async () => {
    expect(weightedCost(10, 100, 10, 200)).toBe(150);
    expect(weightedCost(0, 100, 10, 200)).toBe(200);
    expect(weightedCost(10, null, 10, 200)).toBe(200);
    expect(weightedCost(3, 100, 1, 150)).toBe(112.5);
    const { ctx, db } = setup();
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: `cost:${P1}`,
      value: JSON.stringify({ p: 100, v: {}, cur: "KZT" }),
    });
    const d = await createReceipt(
      ctx,
      { supplierId: null, lines: [{ productId: P1, qty: 10, price: 200 }], updateCost: true },
      "x",
    );
    await postReceipt(ctx, d.id, "x");
    // остаток 10 по 100 + 10 по 200
    expect(costOf(db, P1)!.price).toBe(150);
  });

  it("вариант учитывается отдельно: его цена своя, цена товара не трогается", async () => {
    const { ctx, db } = setup();
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: `cost:${P1}`,
      value: JSON.stringify({ p: 100, v: { Большой: 300 }, cur: "KZT" }),
    });
    const d = await createReceipt(
      ctx,
      {
        supplierId: null,
        lines: [{ productId: P1, variant: "Большой", qty: 10, price: 400 }],
        updateCost: true,
      },
      "x",
    );
    const done = await postReceipt(ctx, d.id, "x");
    expect(done.lines[0]!.cost).toBe(350);
    expect(costOf(db, P1)).toMatchObject({ price: 100, variants: { Большой: 350 } });
    expect(stockOf(db, P1)).toBe(20);
  });

  it("без галочки себестоимость не меняется", async () => {
    const { ctx, db } = setup();
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: `cost:${P1}`,
      value: JSON.stringify({ p: 100, v: {}, cur: "KZT" }),
    });
    const d = await createReceipt(
      ctx,
      { supplierId: null, lines: [{ productId: P1, qty: 10, price: 900 }], updateCost: false },
      "x",
    );
    await postReceipt(ctx, d.id, "x");
    expect(costOf(db, P1)!.price).toBe(100);
  });

  it("товар без учёта остатка и цифровой не принимаются; цифры в границах", async () => {
    const { ctx } = setup();
    const base = { supplierId: null, updateCost: false };
    await expect(
      createReceipt(ctx, { ...base, lines: [{ productId: P3, qty: 1, price: 1 }] }, "x"),
    ).rejects.toMatchObject({ key: "err.stock.untracked" });
    await expect(createReceipt(ctx, { ...base, lines: [] }, "x")).rejects.toMatchObject({
      key: "err.stock.receiptEmpty",
    });
    await expect(
      createReceipt(ctx, { ...base, lines: [{ productId: P1, qty: 0, price: 1 }] }, "x"),
    ).rejects.toMatchObject({ key: "err.stock.badQty" });
    await expect(
      createReceipt(ctx, { ...base, lines: [{ productId: P1, qty: 1.5, price: 1 }] }, "x"),
    ).rejects.toMatchObject({ key: "err.stock.badQty" });
    await expect(
      createReceipt(ctx, { ...base, lines: [{ productId: P1, qty: 1, price: -1 }] }, "x"),
    ).rejects.toMatchObject({ key: "err.stock.badPrice" });
    await expect(
      createReceipt(
        ctx,
        {
          ...base,
          lines: [
            { productId: P1, qty: 1, price: 1 },
            { productId: P1, qty: 2, price: 1 },
          ],
        },
        "x",
      ),
    ).rejects.toMatchObject({ key: "err.stock.receiptDuplicate" });
    await expect(
      createReceipt(
        ctx,
        { ...base, lines: [{ productId: P1, variant: "Нет", qty: 1, price: 1 }] },
        "x",
      ),
    ).rejects.toMatchObject({ key: "err.cost.noVariant" });
  });

  it("черновик правится и удаляется, проведённый — нет", async () => {
    const { ctx, db } = setup();
    const d = await createReceipt(
      ctx,
      { supplierId: null, lines: [{ productId: P1, qty: 5, price: 1 }], updateCost: false },
      "x",
    );
    const e = await updateReceipt(ctx, d.id, {
      supplierId: null,
      lines: [{ productId: P2, qty: 7, price: 2 }],
      updateCost: false,
    });
    expect(e.lines).toHaveLength(1);
    expect(e.lines[0]).toMatchObject({ productId: P2, qty: 7 });
    await postReceipt(ctx, d.id, "x");
    expect(stockOf(db, P2)).toBe(7);
    await expect(deleteReceipt(ctx, d.id)).rejects.toMatchObject({
      key: "err.stock.receiptNotDraft",
    });
    const d2 = await createReceipt(
      ctx,
      { supplierId: null, lines: [{ productId: P1, qty: 5, price: 1 }], updateCost: false },
      "x",
    );
    await deleteReceipt(ctx, d2.id);
    expect(await loadReceipt(ctx, d2.id)).toBeNull();
    await expect(postReceipt(ctx, d2.id, "x")).rejects.toMatchObject({
      key: "err.stock.receiptNotFound",
    });
    expect((await listReceipts(ctx)).map((r) => r.id)).toEqual([d.id]);
  });

  it("оборванное проведение продолжается только с невыполненных строк", async () => {
    const { ctx, db } = setup();
    const d = await createReceipt(
      ctx,
      {
        supplierId: null,
        lines: [
          { productId: P1, qty: 5, price: 1 },
          { productId: P2, qty: 3, price: 1 },
        ],
        updateCost: false,
      },
      "x",
    );
    // Первая строка прошла, процесс умер на второй: документ завис в «posting».
    const row = db.tables.app_settings!.find((r) => r.key === receiptKey(d.id))!;
    const doc = JSON.parse(row.value as string);
    doc.status = "posting";
    doc.claim = "dead";
    doc.postingAt = "2020-01-01T00:00:00.000Z";
    doc.lines[0] = { ...doc.lines[0], state: "done", from: 10, to: 15 };
    row.value = JSON.stringify(doc);
    db.tables.products!.find((p) => p.id === P1)!.stock_quantity = 15;
    const done = await postReceipt(ctx, d.id, "x");
    expect(done.status).toBe("posted");
    expect(stockOf(db, P1)).toBe(15);
    expect(stockOf(db, P2)).toBe(3);
  });

  it("проводящийся прямо сейчас приход не перехватывается", async () => {
    const { ctx, db } = setup();
    const d = await createReceipt(
      ctx,
      { supplierId: null, lines: [{ productId: P1, qty: 5, price: 1 }], updateCost: false },
      "x",
    );
    const row = db.tables.app_settings!.find((r) => r.key === receiptKey(d.id))!;
    const doc = JSON.parse(row.value as string);
    doc.status = "posting";
    doc.claim = "alive";
    doc.postingAt = new Date().toISOString();
    row.value = JSON.stringify(doc);
    await expect(postReceipt(ctx, d.id, "x")).rejects.toMatchObject({
      key: "err.stock.receiptPosted",
    });
    expect(stockOf(db, P1)).toBe(10);
  });

  it("если остаток перестали вести до проведения — строка пропущена, остальные проведены", async () => {
    const { ctx, db } = setup();
    const d = await createReceipt(
      ctx,
      {
        supplierId: null,
        lines: [
          { productId: P1, qty: 5, price: 1 },
          { productId: P2, qty: 3, price: 1 },
        ],
        updateCost: false,
      },
      "x",
    );
    db.tables.products!.find((p) => p.id === P1)!.stock_quantity = null;
    const done = await postReceipt(ctx, d.id, "x");
    expect(done.lines.map((l) => l.state)).toEqual(["skipped", "done"]);
    expect(stockOf(db, P1)).toBeNull();
    expect(stockOf(db, P2)).toBe(3);
  });
});
