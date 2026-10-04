import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateOrderFulfillment } from "./physical-admin";

const BOT = "00000000-0000-0000-0000-000000000015";

function setup(order: Record<string, unknown>) {
  const db = fakeDb();
  db.tables.orders = [
    {
      id: 1,
      bot_id: BOT,
      status: "awaiting_payment",
      paid_amount: 0,
      currency: "KZT",
      country_code: "KZ",
      fulfillment_kind: "physical",
      fulfillment_type: "delivery",
      fulfillment_at: null,
      delivery_zone_id: "z-center",
      discount_amount: 0,
      gift_certificate_discount: 0,
      order_items: [],
      ...order,
    },
  ];
  db.tables.delivery_zones = [
    { id: "z-center", name: "Центр", price: 500, is_active: true, sort_order: 0 },
    { id: "z-left", name: "Левый берег", price: 800, is_active: true, sort_order: 1 },
  ];
  db.tables.app_settings = [{ key: "delivery_free_from", value: "10000" }];
  db.tables.payment_methods = [];
  db.tables.order_events = [];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { ctx, row: () => db.tables.orders![0]! };
}

const edit = (zone: string) => ({
  id: 1,
  fulfillmentAt: null,
  address: "ул. Абая 1",
  note: null,
  fulfillmentType: "delivery" as const,
  deliveryZoneId: zone,
});

describe("смена зоны доставки в админке и порог бесплатной доставки", () => {
  it("заказ на 12 000 при пороге 10 000: новая зона тоже бесплатная", async () => {
    const { ctx, row } = setup({ total: 12000, delivery_fee: 0 });
    await updateOrderFulfillment(ctx, edit("z-left"));
    expect(row()).toMatchObject({ delivery_zone_id: "z-left", delivery_fee: 0, total: 12000 });
  });

  it("товаров на 9 000 — порог не достигнут, цена зоны берётся целиком", async () => {
    const { ctx, row } = setup({ total: 9500, delivery_fee: 500 });
    await updateOrderFulfillment(ctx, edit("z-left"));
    expect(row()).toMatchObject({ delivery_fee: 800, total: 9800 });
  });

  it("порог считается по товарам после промокода: 12 000 − 2 500 = 9 500 — платная", async () => {
    const { ctx, row } = setup({ total: 10000, delivery_fee: 500, discount_amount: 2500 });
    await updateOrderFulfillment(ctx, edit("z-left"));
    expect(row()).toMatchObject({ delivery_fee: 800, total: 10300 });
  });

  it("самовывоз → доставка: порог применяется так же", async () => {
    const { ctx, row } = setup({ total: 12000, delivery_fee: 0, fulfillment_type: "pickup" });
    await updateOrderFulfillment(ctx, edit("z-left"));
    expect(row()).toMatchObject({ fulfillment_type: "delivery", delivery_fee: 0, total: 12000 });
  });
});
