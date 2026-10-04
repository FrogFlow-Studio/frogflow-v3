import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { handleShopMessage } from "./shop.server";
import { COPY } from "@/channels/telegram/copy";

/** Нерабочие дни в Instagram/WhatsApp: те же правила, что в боте (пятница 2026-10-09, сб–вс закрыты). */
function shop() {
  const db = fakeDb();
  db.tables.bot_users = [
    {
      user_key: "ig_1",
      platform: "instagram",
      telegram_id: -1,
      state: {
        locale: "ru",
        mode: "awaiting_fulfillment_date",
        checkout_fulfillment_type: "pickup",
      },
    },
  ];
  db.tables.app_settings = [{ bot_id: "bot-1", key: "fulfillment_closed_weekdays", value: "6,7" }];
  db.tables.cart_items = [{ id: "c1", telegram_id: -1, products: { lead_time_days: 1 } }];
  const ctx = {
    tenant: { id: "bot-1", status: "active", vertical: "digital", modules: {}, settings: {} },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const sent: string[] = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
  } as unknown as ZernioTransport;
  const customer = {
    userKey: "ig_1",
    platform: "instagram",
    telegramId: -1,
    state: { locale: "ru", mode: "awaiting_fulfillment_date", checkout_fulfillment_type: "pickup" },
  } as unknown as Customer;
  const say = (text: string) =>
    handleShopMessage(
      ctx,
      customer,
      {
        conversationId: "c",
        accountId: "a",
        platform: "instagram",
        text,
        postbackPayload: null,
        nativeOrder: null,
        attachments: [],
      } as unknown as ParsedZernioMessage,
      transport,
    );
  return { say, sent, customer, db };
}

describe("Direct/WhatsApp: нерабочие дни", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("воскресенье отклонено, суббота рано, рабочий день принят", async () => {
    const { say, sent, db } = shop();
    const at = () =>
      (db.tables.bot_users![0]!.state as Record<string, unknown>).checkout_fulfillment_at;
    await say("10.10.2026");
    expect(sent.at(-1)).toBe(COPY.ru.fulfillmentDateTooEarly("12.10.2026"));
    await say("18.10.2026");
    expect(sent.at(-1)).toBe(COPY.ru.fulfillmentDateClosed("19.10.2026"));
    expect(at()).toBeUndefined();
    await say("19.10.2026");
    expect(at()).toBe("2026-10-19");
  });
});
