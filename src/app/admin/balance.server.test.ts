import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** «Отклонить чек на остаток»: ожидание снято, покупателю — сообщение на его языке. */
const notified: string[] = [];
let locale: string | undefined;
vi.mock("./admin.server", () => ({
  notifyCustomer: async (_c: unknown, _o: unknown, text: string) => {
    notified.push(text);
    return true;
  },
}));
vi.mock("@/core/customers/customers", () => ({
  getCustomerByTelegramId: async () => ({ state: { locale } }),
}));

const { rejectBalanceProofAndNotify } = await import("./balance.server");
const { balancePayable } = await import("@/core/orders/balance");

const BOT = "00000000-0000-0000-0000-0000000000cc";

function shop() {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.orders = [
    {
      id: 5,
      bot_id: BOT,
      order_no: 5,
      display_no: 105,
      platform: "web",
      telegram_id: -9,
      status: "ready",
      fulfillment_kind: "physical",
      total: 8000,
      paid_amount: 2000,
      currency: "KZT",
      order_items: [],
    },
  ];
  db.tables.zernio_logs = [
    {
      id: "e1",
      bot_id: BOT,
      event_id: "order:5:balance_proof:200000:0",
      event_type: "order.balance_proof",
      status: "event",
      payload: { order_id: 5, path: "p" },
    },
  ];
  const ctx = { tenant: { id: BOT, modules: {}, settings: {} }, db } as unknown as TenantContext;
  return { ctx, db };
}

describe("отклонить чек на остаток", () => {
  it("снимает ожидание и пишет покупателю на его языке; второй раз — понятная ошибка", async () => {
    const { ctx } = shop();
    locale = "en";
    const order = {
      id: 5,
      status: "ready",
      fulfillment_kind: "physical",
      total: 8000,
      paid_amount: 2000,
    };
    expect(await balancePayable(ctx, order)).toBe(0);
    expect(await rejectBalanceProofAndNotify(ctx, 5, "admin:anna")).toEqual({ notified: true });
    expect(notified.at(-1)).toContain("did not accept the balance receipt for order #105");
    expect(await balancePayable(ctx, order)).toBe(6000);
    await expect(rejectBalanceProofAndNotify(ctx, 5, "admin:anna")).rejects.toMatchObject({
      key: "err.orders.noBalanceProof",
    });
    expect(notified).toHaveLength(1);
  });
});
