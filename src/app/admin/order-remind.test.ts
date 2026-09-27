import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Ручное «напомнить об оплате» из админки. */
const notified: Array<{ platform: string; text: string }> = [];
const orders: Record<number, Record<string, unknown>> = {};
vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  getOrder: async (_ctx: unknown, id: number) => orders[id] ?? null,
}));
vi.mock("./locale.server", () => ({ adminTFor: async () => (k: string) => k }));
vi.mock("@/core/outbox/outbox", () => ({
  sendOrEnqueue: async (_ctx: unknown, msg: { text: string }) => {
    notified.push({ platform: "telegram", text: msg.text });
    return true;
  },
}));
vi.mock("@/channels/telegram/outbox", () => ({ telegramOutboxSender: "tg" }));
vi.mock("@/core/storefront/web-notify", () => ({
  emailOrderNotice: async (_ctx: unknown, _o: unknown, text: string) => {
    notified.push({ platform: "web", text });
    return true;
  },
}));
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "s" }) }));

const { runOrderAction } = await import("./admin.server");

function shop() {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.zernio_logs = [];
  db.tables.app_settings = [
    { key: "payment_mode", value: "deposit" },
    { key: "deposit_percent", value: "30" },
  ];
  const ctx = {
    tenant: { id: "b", telegramTokenEnc: null, modules: {}, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

const base = {
  order_no: 7,
  display_no: 7,
  status: "awaiting_payment",
  total: 10000,
  currency: "KZT",
  fulfillment_kind: "digital",
  telegram_id: -3,
  customer_email: "a@b.kz",
  order_items: [],
};

describe("напомнить об оплате", () => {
  it("заказ с сайта: одно напоминание на заказ (тот же ключ, что у крона), без «пришлите чек»", async () => {
    const { ctx, db } = shop();
    orders[1] = { ...base, id: 1, platform: "web" };
    notified.length = 0;
    expect((await runOrderAction(ctx, 1, "remind")).ok).toBe(true);
    expect(notified).toHaveLength(1);
    expect(notified[0]!.text).toContain("Оплатить можно на странице заказа");
    expect(notified[0]!.text).not.toContain("чек");
    expect(db.tables.zernio_logs!.map((r) => r.event_id)).toEqual(["order:1:reminded:email"]);

    const again = await runOrderAction(ctx, 1, "remind");
    expect(again).toEqual({ ok: false, message: "msg.orders.alreadyReminded" });
    expect(notified).toHaveLength(1);
  });

  it("сумма — задаток к оплате сейчас, а не весь заказ", async () => {
    const { ctx } = shop();
    orders[2] = { ...base, id: 2, platform: "web", fulfillment_kind: "physical" };
    notified.length = 0;
    await runOrderAction(ctx, 2, "remind");
    const { formatMoney } = await import("@/core/money/money");
    expect(notified[0]!.text).toContain(`на ${formatMoney(3000, "KZT")} ждёт`);
  });

  it("заказ из бота: кнопка и крон делят одну метку — второе напоминание не уходит", async () => {
    const { ctx, db } = shop();
    db.tables.customers = [];
    db.tables.payment_methods = [];
    orders[3] = { ...base, id: 3, platform: "telegram", telegram_id: 42 };
    notified.length = 0;
    ctx.tenant.telegramTokenEnc = "enc";
    expect((await runOrderAction(ctx, 3, "remind")).ok).toBe(true);
    expect(notified).toHaveLength(1);
    expect(notified[0]!.text).toContain("Заказ #7 ждёт оплаты");
    expect(db.tables.zernio_logs!.map((r) => r.event_id)).toEqual(["order:3:reminded:chat"]);

    const { claimPayReminder } = await import("@/core/orders/pay-remind");
    expect(await claimPayReminder(ctx, 3, "telegram")).toBe(false);
    expect(await runOrderAction(ctx, 3, "remind")).toEqual({
      ok: false,
      message: "msg.orders.alreadyReminded",
    });
  });
});
