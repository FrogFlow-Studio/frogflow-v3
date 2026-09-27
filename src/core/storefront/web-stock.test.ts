import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { rejectOrder } from "@/core/orders/orders";
import { expireWebOrders, WEB_ORDER_TTL_MS } from "./web-expire";
import { placeWebOrder, WEB_MAX_QTY } from "./web-order";
import type { Customer } from "@/core/customers/customers";

/**
 * Заказ с сайта оформляет кто угодно, поэтому списанный им остаток не должен
 * пропадать: отклонённый продавцом и брошенный неоплаченным возвращают товар.
 */
const BOT = "00000000-0000-0000-0000-0000000000cc";
const NOW = new Date("2026-09-27T12:00:00Z");
const old = new Date(NOW.getTime() - WEB_ORDER_TTL_MS - 60_000).toISOString();
const fresh = new Date(NOW.getTime() - 3600_000).toISOString();

function setup(orders: Record<string, unknown>[]) {
  const db = fakeDb();
  db.tables.products = [{ id: "cake", bot_id: BOT, stock_quantity: 2 }];
  db.tables.orders = orders.map((o) => ({ bot_id: BOT, payment_proof_path: null, ...o }));
  db.tables.order_items = orders.map((o) => ({
    id: `i${String(o.id)}`,
    order_id: o.id,
    product_id: "cake",
    quantity: 3,
  }));
  db.tables.order_events = [];
  const ctx = {
    tenant: { id: BOT, modules: { stock: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const stock = (db: ReturnType<typeof fakeDb>) => db.tables.products![0]!.stock_quantity;

describe("склад и заказы с сайта", () => {
  it("отклонённый заказ с сайта возвращает остаток; из бота — как раньше, нет", async () => {
    const { db, ctx } = setup([
      { id: 1, platform: "web", status: "awaiting_confirmation" },
      { id: 2, platform: "telegram", status: "awaiting_confirmation" },
    ]);
    expect(await rejectOrder(ctx, 1, "admin")).toBe(true);
    expect(stock(db)).toBe(5);
    expect(await rejectOrder(ctx, 2, "admin")).toBe(true);
    expect(stock(db)).toBe(5);
  });

  it("неоплаченный сутки заказ с сайта отменяется и возвращает остаток", async () => {
    const { db, ctx } = setup([
      { id: 1, platform: "web", status: "awaiting_payment", created_at: old },
      { id: 2, platform: "web", status: "awaiting_payment", created_at: fresh },
      {
        id: 3,
        platform: "web",
        status: "awaiting_payment",
        created_at: old,
        payment_proof_path: "proofs/x.jpg",
      },
      { id: 4, platform: "web", status: "awaiting_confirmation", created_at: old },
      { id: 5, platform: "telegram", status: "awaiting_payment", created_at: old },
    ]);
    expect(await expireWebOrders(ctx, NOW)).toEqual({ cancelled: 1 });
    expect(db.tables.orders!.map((o) => o.status)).toEqual([
      "cancelled",
      "awaiting_payment",
      "awaiting_payment",
      "awaiting_confirmation",
      "awaiting_payment",
    ]);
    expect(stock(db)).toBe(5);
    // Повтор ничего не трогает.
    expect(await expireWebOrders(ctx, NOW)).toEqual({ cancelled: 0 });
    expect(stock(db)).toBe(5);
  });

  it("больше потолка штук одной позиции — отказ до корзины и склада", async () => {
    const { db, ctx } = setup([]);
    db.tables.cart_items = [];
    const r = await placeWebOrder(
      ctx,
      { userKey: "web_x", telegramId: -5, platform: "web", state: {} } as Customer,
      [{ product_id: "cake", quantity: WEB_MAX_QTY + 1 }],
      "KZ",
    );
    expect(r).toEqual({ ok: false, reason: "too_many" });
    expect(stock(db)).toBe(2);
  });
});
