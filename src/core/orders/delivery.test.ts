import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimOrderForDelivery } from "./orders";

/**
 * Выдача цифровых материалов (и её повтор) захватывает заказ через
 * claimOrderForDelivery: из статусов ожидания оплаты в delivering. Физический
 * заказ в работе этим путём не трогается — у него своя машина статусов.
 */
const BOT = "00000000-0000-0000-0000-000000000001";

function setup(status: string) {
  const db = fakeDb();
  db.tables.orders = [
    { id: 1, bot_id: BOT, status, fulfillment_kind: "physical", total: 15000, order_items: [] },
  ];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { ctx, order: () => db.tables.orders![0]! };
}

describe("claimOrderForDelivery", () => {
  it("processPendingDeliveries не трогает accepted/in_production/ready", async () => {
    for (const status of ["accepted", "in_production", "ready"]) {
      const { ctx, order } = setup(status);
      await expect(claimOrderForDelivery(ctx, 1)).rejects.toThrow();
      expect(order().status).toBe(status);
    }
  });

  it("выданный или уже выдаваемый заказ второй раз не захватывается", async () => {
    for (const status of ["delivered", "delivering"]) {
      const { ctx, order } = setup(status);
      expect(await claimOrderForDelivery(ctx, 1)).toBeNull();
      expect(order().status).toBe(status);
    }
  });
});
