import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { placeOrder, rejectOrder } from "@/core/orders/orders";
import { expireWebOrders } from "@/core/storefront/web-expire";

/**
 * Отмена заказа (rejectOrder — общая для продавца и срока жизни заказов с
 * сайта) возвращает списанные баллы ровно один раз.
 */
const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 777;

// Покупатель с 100 баллами и товаром за 500 в корзине, модуль баллов включён.
function setup() {
  const db = fakeDb();
  // claim_order_placement: захват оформления удаётся.
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 100, state: {} }];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-09-26T00:00:00Z",
      // Встроенный join PostgREST: строка корзины приходит вместе с товаром.
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
    tenant: { id: BOT, modules: { loyalty: true }, settings: {} },
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
    loyaltyPoints: 100,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  };
  return { db, ctx, customer };
}

describe("возврат баллов при отмене заказа (rejectOrder)", () => {
  it("отклонение продавцом возвращает баллы ровно один раз, даже при двух нажатиях", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { usePoints: true });
    if (!r.ok) throw new Error("не оформился");
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(0);
    const [a, b] = await Promise.all([
      rejectOrder(ctx, r.order.id, "admin"),
      rejectOrder(ctx, r.order.id, "bot"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(100);
    expect(await rejectOrder(ctx, r.order.id)).toBe(false);
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(100);
  });

  it("истёкший заказ с сайта: отмена по сроку возвращает баллы", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { usePoints: true });
    if (!r.ok) throw new Error("не оформился");
    Object.assign(db.tables.orders![0]!, {
      platform: "web",
      payment_proof_path: null,
      created_at: "2026-09-20T00:00:00Z",
    });
    db.tables.order_items = [];
    expect(await expireWebOrders(ctx, new Date("2026-09-27T00:00:00Z"))).toEqual({ cancelled: 1 });
    expect(db.tables.orders?.[0]?.status).toBe("cancelled");
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(100);
    // Повторный прогон крона ничего не добавляет.
    await expireWebOrders(ctx, new Date("2026-09-27T01:00:00Z"));
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(100);
  });

  it("оплаченный заказ отмена по сроку не трогает, баллы остаются списанными", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { usePoints: true });
    if (!r.ok) throw new Error("не оформился");
    db.tables.orders![0]!.status = "paid";
    expect(
      await rejectOrder(ctx, r.order.id, "cron", { from: ["awaiting_payment"], to: "cancelled" }),
    ).toBe(false);
    expect(db.tables.orders?.[0]?.status).toBe("paid");
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(0);
  });

  it("заказ без баллов — баланс не меняется", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { usePoints: false });
    if (!r.ok) throw new Error("не оформился");
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(100);
  });

  it("заказ уже выдан и начислил баллы — при отклонении списанное не возвращается", async () => {
    const { db, ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", { usePoints: true });
    if (!r.ok) throw new Error("не оформился");
    // Выдан (начислено 40), продавец нажал «прислать заново», выдача сорвалась.
    Object.assign(db.tables.orders![0]!, { status: "awaiting_confirmation", points_earned: 40 });
    db.tables.bot_users![0]!.loyalty_points = 40;
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(40);
  });
});
