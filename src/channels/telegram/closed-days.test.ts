import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate } from "./handle-update";
import { COPY } from "./copy";
import type { TelegramApi } from "./api";

/** Нерабочие дни в боте: подсказка в вопросе о дате и отказ на выходной (пятница 2026-10-09, сб–вс закрыты). */
const TG = 42;
const BOT = "bot-1";

function setup(locale = "ru") {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: { locale, mode: "awaiting_fulfillment_date", checkout_fulfillment_type: "pickup" },
    },
  ];
  db.tables.app_settings = [
    { bot_id: BOT, key: "fulfillment_closed_weekdays", value: "6,7" },
    { bot_id: BOT, key: "fulfillment_closed_dates", value: "14.10.2026" },
  ];
  db.tables.cart_items = [{ id: "c1", telegram_id: TG, products: { lead_time_days: 1 } }];
  const ctx = {
    tenant: { id: BOT, status: "active", vertical: "digital", modules: {}, settings: {} },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const sent: string[] = [];
  const api = {
    call: vi.fn(async (method: string, p: Record<string, unknown> = {}) => {
      if (method === "sendMessage") sent.push(String(p.text));
      return { ok: true, result: { message_id: 1 } };
    }),
  } as unknown as TelegramApi;
  const say = (text: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: TG, type: "private" },
        from: { id: TG, is_bot: false, first_name: "A" },
        text,
      },
    } as never);
  const state = () => db.tables.bot_users![0]!.state as Record<string, unknown>;
  return { say, sent, state };
}

describe("бот: нерабочие дни", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("воскресенье отклонено с ближайшей рабочей датой, состояние не меняется", async () => {
    const { say, sent, state } = setup();
    await say("11.10.2026");
    expect(sent.at(-1)).toBe(COPY.ru.fulfillmentDateTooEarly("12.10.2026"));
    await say("17.10.2026");
    expect(sent.at(-1)).toBe(COPY.ru.fulfillmentDateClosed("19.10.2026"));
    expect(state().mode).toBe("awaiting_fulfillment_date");
    expect(state().checkout_fulfillment_at).toBeUndefined();
  });

  it("праздничная дата отклонена, соседний рабочий день принят", async () => {
    const { say, sent, state } = setup();
    await say("14.10.2026");
    expect(sent.at(-1)).toBe(COPY.ru.fulfillmentDateClosed("15.10.2026"));
    await say("15.10.2026");
    expect(state().checkout_fulfillment_at).toBe("2026-10-15");
  });

  it("на четырёх языках отказ — не русский текст", async () => {
    for (const l of ["kk", "en", "uz"] as const) {
      const { say, sent } = setup(l);
      await say("17.10.2026");
      expect(sent.at(-1)).toBe(COPY[l].fulfillmentDateClosed("19.10.2026"));
      expect(sent.at(-1)).not.toBe(COPY.ru.fulfillmentDateClosed("19.10.2026"));
    }
  });
});
