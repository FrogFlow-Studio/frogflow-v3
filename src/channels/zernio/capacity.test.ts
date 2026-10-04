import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { handleShopMessage } from "./shop.server";
import { COPY } from "@/channels/telegram/copy";

/** Нерабочие дни в Instagram/WhatsApp: те же правила, что в боте (пятница 2026-10-09, сб–вс закрыты). */
function shop(settings: Record<string, string>, taken: string[]) {
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
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: "bot-1",
    key,
    value,
  }));
  db.tables.orders = taken.map((at, i) => ({
    id: i + 1,
    fulfillment_kind: "physical",
    fulfillment_at: at,
    status: "accepted",
  }));
  db.tables.cart_items = [{ id: "c1", telegram_id: -1, products: { lead_time_days: 0 } }];
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
  const say = (text: string) => {
    // Покупатель приходит каждый раз заново — состояние из базы, как в вебхуке.
    customer.state = db.tables.bot_users![0]!.state as Customer["state"];
    return handleShopMessage(
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
  };
  return { say, sent, customer, db };
}

describe("Direct/WhatsApp: лимит заказов", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("занятая дата отклонена; слоты — нумерованный список только свободных, выбор по номеру", async () => {
    const { say, sent, db } = shop(
      {
        fulfillment_day_limit: "5",
        fulfillment_slot_limit: "1",
        fulfillment_slots: "10:00–12:00\n12:00–14:00",
      },
      ["2026-10-13T10:00:00Z"],
    );
    const at = () =>
      (db.tables.bot_users![0]!.state as Record<string, unknown>).checkout_fulfillment_at;
    await say("13.10.2026");
    expect(sent.at(-1)).toContain("1. 12:00–14:00");
    expect(sent.at(-1)).not.toContain("10:00–12:00");
    await say("10:00–12:00");
    expect(sent.some((t) => t === COPY.ru.fulfillmentSlotFull)).toBe(true);
    await say("1");
    expect(at()).toBe("2026-10-13T12:00");
  });

  it("день набран — отказ с ближайшей свободной датой", async () => {
    const { say, sent } = shop({ fulfillment_day_limit: "1" }, ["2026-10-13T00:00:00Z"]);
    await say("13.10.2026");
    expect(sent.at(-1)).toBe(COPY.ru.fulfillmentDateFull("14.10.2026"));
  });
});
