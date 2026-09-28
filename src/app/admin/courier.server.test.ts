import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Передача заказа курьеру из карточки (модуль courier). */
const notified: string[] = [];
let deliver = true;
const orders: Record<number, Record<string, unknown>> = {};
vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  getOrder: async (_ctx: unknown, id: number) => orders[id] ?? null,
}));
vi.mock("./locale.server", () => ({ adminTFor: async () => (k: string) => k }));
vi.mock("@/core/outbox/outbox", () => ({
  sendOrEnqueue: async (_ctx: unknown, msg: { text: string }) => {
    notified.push(msg.text);
    return deliver;
  },
}));
vi.mock("@/channels/telegram/outbox", () => ({ telegramOutboxSender: "tg" }));
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "s" }) }));

const { dispatchCourier } = await import("./admin.server");

function shop() {
  const db = fakeDb();
  db.tables.zernio_logs = [];
  const ctx = {
    tenant: { id: "b", telegramTokenEnc: "enc", modules: { courier: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

const base = {
  display_no: 12,
  order_no: 12,
  status: "ready",
  total: 10000,
  currency: "KZT",
  fulfillment_kind: "physical",
  platform: "telegram",
  telegram_id: 555,
  order_items: [],
};

describe("передать заказ курьеру", () => {
  it("событие в таймлайн, покупателю — служба, ссылка и телефон", async () => {
    const { ctx, db } = shop();
    orders[1] = { ...base, id: 1 };
    notified.length = 0;
    deliver = true;
    const r = await dispatchCourier(ctx, 1, {
      provider: "yandex",
      trackUrl: "https://dostavka.yandex.ru/route/abc",
      phone: "+7 700 000 00 00",
    });
    expect(r).toEqual({ ok: true, notified: true, message: "msg.courier.sent" });
    expect(notified[0]).toContain("Яндекс Доставка");
    expect(notified[0]).toContain("https://dostavka.yandex.ru/route/abc");
    const ev = db.tables.zernio_logs!.find((e) => e.event_type === "order.courier");
    expect(ev?.payload).toMatchObject({
      order_id: 1,
      provider: "yandex",
      trackUrl: "https://dostavka.yandex.ru/route/abc",
      phone: "+7 700 000 00 00",
    });
  });

  it("сообщение не дошло — курьер всё равно записан, продавцу об этом сказано", async () => {
    const { ctx, db } = shop();
    orders[2] = { ...base, id: 2 };
    deliver = false;
    const r = await dispatchCourier(ctx, 2, { provider: "indrive" });
    expect(r.message).toBe("msg.courier.saved");
    expect(db.tables.zernio_logs!.some((e) => e.event_type === "order.courier")).toBe(true);
  });

  it("не физический, закрытый заказ и небезопасная ссылка — отказ без записи", async () => {
    const { ctx, db } = shop();
    orders[3] = { ...base, id: 3, fulfillment_kind: "digital" };
    orders[4] = { ...base, id: 4, status: "delivered" };
    orders[5] = { ...base, id: 5 };
    await expect(dispatchCourier(ctx, 3, { provider: "own" })).rejects.toMatchObject({
      key: "err.courier.status",
    });
    await expect(dispatchCourier(ctx, 4, { provider: "own" })).rejects.toMatchObject({
      key: "err.courier.status",
    });
    await expect(
      dispatchCourier(ctx, 5, { provider: "own", trackUrl: "javascript:alert(1)" }),
    ).rejects.toMatchObject({ key: "err.courier.badUrl" });
    await expect(
      dispatchCourier(ctx, 5, { provider: "own", phone: "звоните" }),
    ).rejects.toMatchObject({ key: "err.courier.badPhone" });
    expect(db.tables.zernio_logs).toEqual([]);
  });
});
