import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { acceptPhysicalOrder } from "./physical-admin";

const BOT = "00000000-0000-0000-0000-000000000001";

function setup(status: string, settings: Record<string, string> = {}) {
  const db = fakeDb();
  db.tables.orders = [
    {
      id: 1,
      bot_id: BOT,
      status,
      total: 15000,
      paid_amount: 0,
      currency: "KZT",
      fulfillment_kind: "physical",
    },
  ];
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({ key, value }));
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  const order = () => db.tables.orders![0]!;
  return { ctx, order };
}

describe("acceptPhysicalOrder — «Принять заказ»", () => {
  it("acceptOrder переводит awaiting_confirmation в accepted", async () => {
    const { ctx, order } = setup("awaiting_confirmation");
    const r = await acceptPhysicalOrder(ctx, 1);
    expect(r).toMatchObject({ ok: true, alreadyAccepted: false });
    expect(order().status).toBe("accepted");
  });

  it("с чеком пишет положенный задаток", async () => {
    const { ctx, order } = setup("awaiting_confirmation", {
      payment_mode: "deposit",
      deposit_percent: "40",
    });
    expect((await acceptPhysicalOrder(ctx, 1)).recorded).toBe(6000);
    expect(order().paid_amount).toBe(6000);
  });

  it("acceptOrder повторно на уже принятом — alreadyAccepted, статус не меняется", async () => {
    const { ctx, order } = setup("accepted");
    const r = await acceptPhysicalOrder(ctx, 1);
    expect(r).toMatchObject({ ok: false, alreadyAccepted: true, recorded: 0 });
    expect(order().status).toBe("accepted");
    expect(order().paid_amount).toBe(0);
  });

  it("два одновременных «Принять» не двоят задаток", async () => {
    const { ctx, order } = setup("awaiting_confirmation");
    const [a, b] = await Promise.all([acceptPhysicalOrder(ctx, 1), acceptPhysicalOrder(ctx, 1)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(order().paid_amount).toBe(15000);
  });

  it("acceptOrder на delivered — тоже alreadyAccepted, не пытается принять заново", async () => {
    const { ctx, order } = setup("delivered");
    const r = await acceptPhysicalOrder(ctx, 1);
    expect(r).toMatchObject({ ok: false, alreadyAccepted: true });
    expect(order().status).toBe("delivered");
  });

  // В v1 acceptOrder бросал; в v2 — отказ ok: false, заказ остаётся отклонённым.
  it("acceptOrder на rejected — отклонённый заказ обратно в работу не берут", async () => {
    const { ctx, order } = setup("rejected");
    const r = await acceptPhysicalOrder(ctx, 1);
    expect(r.ok).toBe(false);
    expect(order().status).toBe("rejected");
    expect(order().paid_amount).toBe(0);
  });
});
