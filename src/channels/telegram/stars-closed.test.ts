import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "./api";

/** Звёзды списаны по закрытому заказу: событие в журнале и одно уведомление продавцу. */
const notifyAdminsHtml = vi.fn(async (..._a: unknown[]) => 1);
vi.mock("./notify", async (orig) => ({
  ...(await orig<typeof import("./notify")>()),
  notifyAdminsHtml,
}));

const { handleTelegramUpdate } = await import("./handle-update");

const TG = 42;
let db: FakeDb;
let ctx: TenantContext;
const api = { call: vi.fn(async () => ({ ok: true, result: {} })) } as unknown as TelegramApi;

const paid = (charge: string) =>
  ({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: TG, type: "private" },
      from: { id: TG, is_bot: false, first_name: "A" },
      successful_payment: {
        currency: "XTR",
        total_amount: 200,
        invoice_payload: "order:7",
        telegram_payment_charge_id: charge,
      },
    },
  }) as never;

beforeEach(() => {
  notifyAdminsHtml.mockClear();
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.orders = [
    {
      id: 7,
      order_no: 7,
      display_no: 7,
      telegram_id: TG,
      status: "rejected",
      fulfillment_kind: "digital",
      total: 1300,
      paid_amount: 0,
      currency: "KZT",
    },
  ];
  db.tables.zernio_logs = [];
  db.tables.app_settings = [];
  ctx = {
    tenant: { id: "bot-1", status: "active", vertical: "digital", modules: {}, settings: {} },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
});

describe("Telegram Stars по закрытому заказу", () => {
  it("платёж в журнале заказа, одно уведомление; повтор колбэка ничего не добавляет", async () => {
    await handleTelegramUpdate(ctx, api, paid("ch_1"));
    await handleTelegramUpdate(ctx, api, paid("ch_1"));
    const events = db.tables.zernio_logs!.filter((e) => e.event_type === "order.payment_on_closed");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      order_id: 7,
      amount: 1300,
      currency: "KZT",
      provider: "Telegram Stars",
      invId: "ch_1",
      status: "rejected",
    });
    expect(notifyAdminsHtml).toHaveBeenCalledTimes(1);
    expect(db.tables.orders![0]!.status).toBe("rejected");
  });
});
