import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { cartSummary, placeOrder } from "@/core/orders/orders";

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
