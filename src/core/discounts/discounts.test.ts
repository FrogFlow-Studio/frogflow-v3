import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { cartSummary, placeOrder } from "@/core/orders/orders";
import { setPhysicalStatus } from "@/core/orders/admin";
import { parseMaxRedeemPercent } from "./discounts";

/**
 * Баллы лояльности списываются только с согласия покупателя
 * (opts.usePoints) — и в предпросмотре корзины, и при оформлении.
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

describe("баллы лояльности при оформлении", () => {
  it("без согласия сумму не трогает и баллы не списывает", async () => {
    const { db, ctx, customer } = setup();
    const summary = await cartSummary(ctx, customer, { total: 500, currency: "KZT" }, {});
    expect(summary.total).toBe(500);
    expect(summary.points).toEqual({ balance: 100, discount: 0, used: false });

    const r = await placeOrder(ctx, customer, "KZ", { usePoints: false });
    expect(r.ok).toBe(true);
    expect(db.tables.orders?.[0]).toMatchObject({ total: 500, points_used: 0 });
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(100);
  });

  it("с согласием: товар 500, на балансе 100 — к оплате 400", async () => {
    const { db, ctx, customer } = setup();
    const summary = await cartSummary(
      ctx,
      customer,
      { total: 500, currency: "KZT" },
      { usePoints: true },
    );
    expect(summary.total).toBe(400);

    const r = await placeOrder(ctx, customer, "KZ", { usePoints: true });
    expect(r.ok).toBe(true);
    expect(db.tables.orders?.[0]).toMatchObject({ total: 400, points_used: 100 });
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(0);
  });
});

describe("потолок списания баллами (loyalty_max_redeem_percent)", () => {
  it("на балансе 400, потолок 20 % — списано 100, к оплате 400, остаток 300", async () => {
    const { db, ctx, customer } = setup();
    db.tables.bot_users![0]!.loyalty_points = 400;
    db.tables.app_settings = [{ key: "loyalty_max_redeem_percent", value: "20" }];
    const summary = await cartSummary(
      ctx,
      customer,
      { total: 500, currency: "KZT" },
      { usePoints: true },
    );
    expect(summary.points).toEqual({ balance: 400, discount: 100, used: true });
    expect(summary.total).toBe(400);

    const r = await placeOrder(ctx, customer, "KZ", { usePoints: true });
    expect(r.ok && r.amountDue).toBe(400);
    expect(db.tables.orders?.[0]).toMatchObject({ total: 400, points_used: 100 });
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(300);
  });

  it("неверное значение — как не задано: вся сумма, как в v1", () => {
    expect(parseMaxRedeemPercent(null)).toBe(100);
    expect(parseMaxRedeemPercent("")).toBe(100);
    expect(parseMaxRedeemPercent("abc")).toBe(100);
    expect(parseMaxRedeemPercent("150")).toBe(100);
    expect(parseMaxRedeemPercent("0")).toBe(0);
    expect(parseMaxRedeemPercent("33.7")).toBe(33);
  });
});

describe("баллы за выданный физический заказ", () => {
  it("физический заказ выдан — баллы за сумму после списания, повторно не начисляются", async () => {
    const { db, ctx } = setup();
    db.tables.app_settings = [{ key: "loyalty_earn_percent", value: "10" }];
    db.tables.orders = [{ id: 5, telegram_id: TG, total: 400, points_earned: 0, status: "ready" }];
    expect(await setPhysicalStatus(ctx, 5, "ready", "delivered")).toBe(true);
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(140);
    db.tables.orders[0]!.status = "ready";
    await setPhysicalStatus(ctx, 5, "ready", "delivered");
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(140);
    // Шаг назад по статусам баллов не даёт.
    db.tables.orders[0]!.status = "in_production";
    await setPhysicalStatus(ctx, 5, "in_production", "ready");
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(140);
  });

  it("без модуля лояльности выдача баллов не начисляет", async () => {
    const { db, ctx } = setup();
    (ctx.tenant.modules as Record<string, boolean>).loyalty = false;
    db.tables.orders = [{ id: 6, telegram_id: TG, total: 400, points_earned: 0, status: "ready" }];
    await setPhysicalStatus(ctx, 6, "ready", "delivered");
    expect(db.tables.bot_users?.[0]?.loyalty_points).toBe(100);
  });
});
