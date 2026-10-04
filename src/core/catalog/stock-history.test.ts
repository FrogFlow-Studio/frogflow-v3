import { beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import { decrementStock, restoreOrderStock } from "@/core/fulfillment/fulfillment";
import { bulkUpdateProducts } from "./bulk";
import { listStockHistory, recordStockChanges, type StockChange } from "./stock-history";

const BOT = "11111111-2222-3333-4444-555555555555";
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";

let db: FakeDb;
let ctx: TenantContext;

beforeEach(() => {
  db = fakeDb();
  db.tables.products = [
    { id: P1, name: "Торт", stock_quantity: 10 },
    { id: P2, name: "Печенье", stock_quantity: 4 },
  ];
  db.tables.orders = [{ id: 501, order_no: 501, display_no: 77 }];
  db.tables.order_items = [{ id: "i1", order_id: 501, product_id: P1, quantity: 3 }];
  db.tables.zernio_logs = [];
  db.tables.app_settings = [];
  db.tables.product_variants = [];
  ctx = {
    tenant: { id: BOT, modules: { stock: true }, settings: { served_by: "v2" } },
    db,
  } as unknown as TenantContext;
});

/** В базе created_at ставит default now(); fakeDb при insert его не ставит. */
const stamped = () => {
  for (const r of db.tables.zernio_logs!) r.created_at ??= new Date().toISOString();
};

describe("история остатка", () => {
  it("списание при заказе: событие с «было → стало», номером заказа и покупателем", async () => {
    const sink: StockChange[] = [];
    expect(await decrementStock(ctx, P1, 3, sink)).toBe(true);
    // До создания заказа в истории пусто: откат оформления не оставляет пар «−3, +3».
    expect(db.tables.zernio_logs).toHaveLength(0);
    await recordStockChanges(ctx, sink, { reason: "order", orderId: 501, actor: "customer" });
    stamped();
    const { entries, total } = await listStockHistory(ctx, P1);
    expect(total).toBe(1);
    expect(entries[0]).toMatchObject({
      reason: "order",
      from: 10,
      to: 7,
      orderId: 501,
      orderNo: 77,
      actor: "customer",
    });
    expect(db.tables.products![0]!.stock_quantity).toBe(7);
  });

  it("не хватило остатка: списания и события нет, в минус не уходит", async () => {
    const sink: StockChange[] = [];
    expect(await decrementStock(ctx, P2, 5, sink)).toBe(false);
    expect(sink).toEqual([]);
    expect(db.tables.products![1]!.stock_quantity).toBe(4);
  });

  it("возврат заказа на склад пишет событие cancel или refund с заказом", async () => {
    expect(await restoreOrderStock(ctx, 501, "refund", "admin:anna")).toBe(1);
    stamped();
    const { entries } = await listStockHistory(ctx, P1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      reason: "refund",
      from: 10,
      to: 13,
      orderNo: 77,
      actor: "admin:anna",
    });
  });

  it("массовое «прибавить» — по событию на каждый товар, чужой товар в историю не попадает", async () => {
    await bulkUpdateProducts(
      ctx,
      [P1, P2],
      { kind: "stock", mode: "add", amount: 5 },
      "admin:anna",
    );
    stamped();
    const one = await listStockHistory(ctx, P1);
    expect(one.entries).toHaveLength(1);
    expect(one.entries[0]).toMatchObject({ reason: "bulk", from: 10, to: 15, actor: "admin:anna" });
    const two = await listStockHistory(ctx, P2);
    expect(two.entries[0]).toMatchObject({ from: 4, to: 9 });
  });

  it("«было = стало» — не событие", async () => {
    await recordStockChanges(ctx, [{ productId: P1, from: 5, to: 5 }], { reason: "edit" });
    expect(db.tables.zernio_logs).toHaveLength(0);
  });

  it("товар без учёта остатка: «не учитывался → 5»", async () => {
    await recordStockChanges(ctx, [{ productId: P1, from: null, to: 5 }], {
      reason: "edit",
      actor: "admin:anna",
    });
    stamped();
    const { entries } = await listStockHistory(ctx, P1);
    expect(entries[0]).toMatchObject({ from: null, to: 5 });
  });

  it("только последние 30 дней; страницы без пропусков и повторов, свежие сверху", async () => {
    const now = new Date("2026-10-04T12:00:00Z");
    const rows = Array.from({ length: 45 }, (_, i) => ({
      id: `e${String(i).padStart(3, "0")}`,
      bot_id: BOT,
      event_type: "stock.edit",
      status: "event",
      // Все в одну секунду для первых 25: порядок решает id.
      created_at: new Date(now.getTime() - (i < 25 ? 1000 : (i - 24) * 3_600_000)).toISOString(),
      payload: { product_id: P1, from: i, to: i + 1, actor: "system" },
    }));
    rows.push({
      id: "old",
      bot_id: BOT,
      event_type: "stock.edit",
      status: "event",
      created_at: new Date(now.getTime() - 31 * 86_400_000).toISOString(),
      payload: { product_id: P1, from: 0, to: 1, actor: "system" },
    });
    db.tables.zernio_logs = rows;
    const first = await listStockHistory(ctx, P1, { page: 0, pageSize: 20, now });
    const second = await listStockHistory(ctx, P1, { page: 1, pageSize: 20, now });
    const third = await listStockHistory(ctx, P1, { page: 2, pageSize: 20, now });
    expect(first.total).toBe(45);
    const ids = [...first.entries, ...second.entries, ...third.entries].map((e) => e.id);
    expect(ids).toHaveLength(45);
    expect(new Set(ids).size).toBe(45);
    expect(ids).not.toContain("old");
  });

  it("сбой чтения истории — ошибка, а не «остаток не менялся»", async () => {
    const broken = { ...ctx, db: withBrokenReads(db, ["zernio_logs"]) } as unknown as TenantContext;
    await expect(listStockHistory(broken, P1)).rejects.toThrow();
  });

  it("сбой записи журнала не ломает операцию (только в консоль)", async () => {
    const brokenWrite = {
      ...ctx,
      db: new Proxy(db, {
        get: (t, k) =>
          k === "from"
            ? (table: string) =>
                table === "zernio_logs"
                  ? {
                      insert: async () => ({ error: { message: "down" } }),
                    }
                  : t.from(table)
            : (t as unknown as Record<string | symbol, unknown>)[k],
      }),
    } as unknown as TenantContext;
    await expect(
      recordStockChanges(brokenWrite, [{ productId: P1, from: 1, to: 2 }], { reason: "edit" }),
    ).resolves.toBeUndefined();
  });
});
