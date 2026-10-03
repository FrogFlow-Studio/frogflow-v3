import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder, rejectOrder } from "@/core/orders/orders";

/**
 * Остаток списывается при любом оформлении (модуль «Склад»), а брошенные
 * заказы бота сами не истекают: отклонённый неоплаченный заказ любого канала
 * обязан вернуть товар на склад — ровно один раз.
 */
const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;

function setup() {
  const db = fakeDb();
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 0, state: {} }];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.products = [{ id: "p-1", stock_quantity: 1 }];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-09-26T00:00:00Z",
      products: {
        id: "p-1",
        name: "Методичка",
        price: 500,
        currency: "KZT",
        fulfillment_kind: "digital",
        file_path: `${BOT}/m.pdf`,
      },
      product_variants: null,
    },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { stock: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  const customer: Customer = {
    userKey: `tg:${TG}`,
    platform: "telegram",
    telegramId: TG,
    username: null,
    firstName: "Аня",
    lastName: null,
    languageCode: "ru",
    contactPhone: null,
    email: null,
    loyaltyPoints: 0,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  };
  return { db, ctx, customer };
}

describe("возврат остатка при отклонении заказа бота", () => {
  it("неоплаченный заказ отклонили — остаток вернулся ровно один раз", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", {});
    if (!r.ok) throw new Error(`не оформился: ${r.reason}`);
    expect(db.tables.products![0]!.stock_quantity).toBe(0);
    const res = await Promise.all([
      rejectOrder(ctx, r.order.id, "admin"),
      rejectOrder(ctx, r.order.id, "admin"),
    ]);
    expect(res.filter(Boolean)).toHaveLength(1);
    expect(db.tables.products![0]!.stock_quantity).toBe(1);
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(false);
    expect(db.tables.products![0]!.stock_quantity).toBe(1);
  });

  it("часть оплаты уже внесена — остаток решает возврат, отклонение его не трогает", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", {});
    if (!r.ok) throw new Error("не оформился");
    db.tables.orders![0]!.paid_amount = 100;
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    expect(db.tables.products![0]!.stock_quantity).toBe(0);
  });
});
