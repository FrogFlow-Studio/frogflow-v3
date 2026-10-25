import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { Customer } from "@/core/customers/customers";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { cancelCustomerOrder } from "./customer-cancel.server";

const BOT = "11111111-1111-1111-1111-111111111111";
const buyer = (telegramId = 777): Customer =>
  ({ userKey: `wa_${telegramId}`, telegramId, state: {}, platform: "whatsapp" }) as Customer;

function setup(overrides: Record<string, unknown> = {}) {
  const db = fakeDb();
  db.tables.orders = [
    {
      id: 19,
      bot_id: BOT,
      telegram_id: 777,
      order_no: 18,
      display_no: 270,
      status: "awaiting_payment",
      paid_amount: 0,
      platform: "whatsapp",
      points_used: 0,
      points_earned: 0,
      promo_code: null,
      ...overrides,
    },
  ];
  db.tables.order_items = [];
  db.tables.products = [];
  const ctx = { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext;
  return { db, ctx };
}

describe("cancelCustomerOrder", () => {
  it("отменяет заказ по видимому номеру только у его покупателя", async () => {
    const { db, ctx } = setup();

    const result = await cancelCustomerOrder(ctx, buyer(), 270);

    expect(result).toEqual({ kind: "cancelled", orderId: 19, orderNumber: 270 });
    expect(db.tables.orders![0]!.status).toBe("cancelled");
  });

  it("не отменяет заказ, если в нём уже есть внесённая сумма", async () => {
    const { db, ctx } = setup({ paid_amount: 100 });

    const result = await cancelCustomerOrder(ctx, buyer(), 270);

    expect(result).toEqual({
      kind: "not_cancellable",
      orderNumber: 270,
      status: "awaiting_payment",
    });
    expect(db.tables.orders![0]!.status).toBe("awaiting_payment");
  });

  it("не находит заказ другого покупателя", async () => {
    const { ctx } = setup();

    expect(await cancelCustomerOrder(ctx, buyer(888), 270)).toEqual({
      kind: "not_found",
      orderNumber: 270,
    });
  });
});
