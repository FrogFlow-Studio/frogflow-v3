import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { rejectOrder } from "./orders";
import { markInvoiceLink } from "./invoice-link";
import { expireWebOrders } from "@/core/storefront/web-expire";

/**
 * Счёт ссылкой из Instagram/WhatsApp живёт, как заказ с сайта: без оплаты
 * через сутки отменяется и возвращает остаток на склад. Иначе каждый повтор
 * «Выставить счёт» после сбоя Zernio оставлял бы вечный «ждёт оплаты».
 */
const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-09-27T12:00:00Z");

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.zernio_logs = [];
  db.tables.products = [{ id: "p-1", bot_id: BOT, name: "Прописи", stock_quantity: 3 }];
  const order = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    bot_id: BOT,
    platform: "instagram",
    telegram_id: -7,
    status: "awaiting_payment",
    payment_proof_path: null,
    points_used: 0,
    points_earned: 0,
    promo_code: null,
    created_at: "2026-09-26T08:00:00Z",
    ...over,
  });
  db.tables.orders = [order(1), order(2), order(3, { payment_proof_path: "proofs/3.jpg" })];
  db.tables.order_items = [1, 2, 3].map((id) => ({
    id: `i${id}`,
    order_id: id,
    bot_id: BOT,
    product_id: "p-1",
    quantity: 1,
    name_snapshot: "Прописи",
    price_snapshot: 100,
  }));
  const ctx = {
    tenant: { id: BOT, modules: { stock: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("счёт ссылкой: срок оплаты и возврат остатка", () => {
  it("неоплаченный счёт ссылкой через сутки отменяется и возвращает остаток; обычный заказ из Instagram — нет", async () => {
    const { db, ctx } = setup();
    // Метки ставятся при выставлении счёта: заказ 1 и заказ 3 (с чеком).
    await markInvoiceLink(ctx, 1);
    await markInvoiceLink(ctx, 3);
    for (const r of db.tables.app_settings!) r.updated_at = "2026-09-26T08:00:00Z";
    expect(await expireWebOrders(ctx, NOW)).toEqual({ cancelled: 1 });
    expect(db.tables.orders!.map((o) => [o.id, o.status])).toEqual([
      [1, "cancelled"],
      [2, "awaiting_payment"],
      [3, "awaiting_payment"],
    ]);
    expect(db.tables.products![0]!.stock_quantity).toBe(4);
    // Повторный прогон крона ничего не добавляет.
    await expireWebOrders(ctx, new Date(NOW.getTime() + 3600_000));
    expect(db.tables.products![0]!.stock_quantity).toBe(4);
  });

  it("счёт младше суток не трогается", async () => {
    const { db, ctx } = setup();
    db.tables.orders![0]!.created_at = "2026-09-27T08:00:00Z";
    await markInvoiceLink(ctx, 1);
    expect(await expireWebOrders(ctx, NOW)).toEqual({ cancelled: 0 });
  });

  it("продавец отклонил счёт ссылкой — остаток на склад; обычный заказ Instagram — склад не трогаем", async () => {
    const { db, ctx } = setup();
    await markInvoiceLink(ctx, 1);
    expect(await rejectOrder(ctx, 1, "admin")).toBe(true);
    expect(db.tables.products![0]!.stock_quantity).toBe(4);
    expect(await rejectOrder(ctx, 2, "admin")).toBe(true);
    expect(db.tables.products![0]!.stock_quantity).toBe(4);
  });
});

describe("список счетов ссылкой: ничего не теряется (Б28)", () => {
  it("больше 1000 записей — приходят все, потолок ответа базы не режет", async () => {
    const db = fakeDb({ maxRows: 1000 });
    db.tables.app_settings = Array.from({ length: 1500 }, (_, i) => ({
      bot_id: BOT,
      key: `invoice_link:${i + 1}`,
      value: "x",
      updated_at: "2026-09-27T10:00:00Z",
    }));
    const ctx = { tenant: { id: BOT, settings: {} }, db } as unknown as TenantContext;
    const { invoiceLinkOrderIds } = await import("./invoice-link");
    const ids = await invoiceLinkOrderIds(ctx, new Date("2026-09-26T00:00:00Z"));
    expect(ids).toHaveLength(1500);
    expect(new Set(ids).size).toBe(1500);
  });
});
