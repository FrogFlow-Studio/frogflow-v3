import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate } from "./handle-update";
import { COPY } from "./copy";
import type { TelegramApi } from "./api";

/** Лимит заказов в боте: занятая дата отклоняется, в списке слотов нет занятых (сегодня 2026-10-09). */
const TG = 42;
const BOT = "bot-1";

function setup(settings: Record<string, string>, taken: string[]) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: {
        locale: "ru",
        mode: "awaiting_fulfillment_date",
        checkout_fulfillment_type: "pickup",
      },
    },
  ];
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: BOT,
    key,
    value,
  }));
  db.tables.orders = taken.map((at, i) => ({
    id: i + 1,
    fulfillment_kind: "physical",
    fulfillment_at: at,
    status: "accepted",
  }));
  db.tables.cart_items = [{ id: "c1", telegram_id: TG, products: { lead_time_days: 0 } }];
  const ctx = {
    tenant: { id: BOT, status: "active", vertical: "digital", modules: {}, settings: {} },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const calls: Array<{ method: string; p: Record<string, unknown> }> = [];
  const api = {
    call: vi.fn(async (method: string, p: Record<string, unknown> = {}) => {
      calls.push({ method, p });
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
  const texts = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.p.text));
  const state = () => db.tables.bot_users![0]!.state as Record<string, unknown>;
  return { say, texts, calls, state, db };
}

describe("бот: лимит заказов", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("занятая дата отклонена с ближайшей свободной, свободная принята", async () => {
    const { say, texts, state } = setup({ fulfillment_day_limit: "1" }, ["2026-10-13T00:00:00Z"]);
    await say("13.10.2026");
    expect(texts().at(-1)).toBe(COPY.ru.fulfillmentDateFull("14.10.2026"));
    expect(state().checkout_fulfillment_at).toBeUndefined();
    await say("14.10.2026");
    expect(state().checkout_fulfillment_at).toBe("2026-10-14");
  });

  it("в списке слотов нет занятого, номер кнопки — место слота в списке магазина", async () => {
    const { say, calls } = setup(
      { fulfillment_slot_limit: "1", fulfillment_slots: "10:00–12:00\n12:00–14:00" },
      ["2026-10-13T10:00:00Z"],
    );
    await say("13.10.2026");
    const last = calls.filter((c) => c.method === "sendMessage").at(-1)!;
    const keyboard = (
      last.p.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      }
    ).inline_keyboard;
    expect(keyboard).toEqual([[{ text: "12:00–14:00", callback_data: "slot:1" }]]);
  });

  it("занятый слот, названный текстом, отклонён, список слотов показан снова", async () => {
    const { say, texts, state } = setup(
      { fulfillment_slot_limit: "1", fulfillment_slots: "10:00–12:00\n12:00–14:00" },
      ["2026-10-13T10:00:00Z"],
    );
    await say("13.10.2026");
    await say("10:00–12:00");
    expect(texts()).toContain(COPY.ru.fulfillmentSlotFull);
    expect(state().checkout_fulfillment_at).toBe("2026-10-13");
    await say("12:00–14:00");
    expect(state().checkout_fulfillment_at).toBe("2026-10-13T12:00");
  });
});

describe("бот: минимум даты считается при ответе", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Суббота 10:00 по Алматы; вопрос о дате был в пятницу вечером (минимум — суббота).
    vi.setSystemTime(new Date("2026-10-10T05:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("срок изготовления 1 день: ответ «суббота» на следующий день после вопроса отклонён, минимум — воскресенье", async () => {
    const { say, texts, state, db } = setup({}, []);
    (db.tables.cart_items![0]!.products as Record<string, unknown>).lead_time_days = 1;
    Object.assign(state(), { checkout_min_fulfillment_date: "2026-10-10" });
    await say("10.10.2026");
    expect(texts().at(-1)).toBe(COPY.ru.fulfillmentDateTooEarly("11.10.2026"));
    expect(state().checkout_fulfillment_at).toBeUndefined();
    await say("11.10.2026");
    expect(state().checkout_fulfillment_at).toBe("2026-10-11");
  });
});
