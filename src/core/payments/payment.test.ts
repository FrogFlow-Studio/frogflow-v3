import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/core/settings/settings", () => ({ getSettings: async () => ({}) }));

const { markPaidOnline } = await import("./payment");

let db: FakeDb;
const ctx = () => ({ tenant: { id: "shop-1", modules: {} }, db }) as unknown as TenantContext;

beforeEach(() => {
  db = fakeDb();
  db.tables.orders = [
    {
      id: 7,
      bot_id: "shop-1",
      status: "awaiting_payment",
      fulfillment_kind: "digital",
      admin_note: null,
      paid_amount: 0,
      total: 3000,
      currency: "KZT",
    },
  ];
  db.tables.zernio_logs = [];
});

describe("онлайн-оплата пишет платёж в журнал заказа", () => {
  it("первый колбэк — событие payment с суммой и шлюзом, повтор — ничего", async () => {
    expect(await markPaidOnline(ctx(), 7, 3000, "Robokassa", "7")).toMatchObject({
      ok: true,
      alreadyDone: false,
    });
    expect(await markPaidOnline(ctx(), 7, 3000, "Robokassa")).toMatchObject({ alreadyDone: true });
    const events = db.tables.zernio_logs!.filter((e) => e.event_type === "order.payment");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      order_id: 7,
      amount: 3000,
      currency: "KZT",
      source: "online",
      provider: "Robokassa",
      invId: "7",
    });
  });
});
