import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate } from "./handle-update";
import type { TelegramApi } from "./api";

/**
 * Адаптер Telegram на фейковой базе: «Мои заказы» и кнопки прошлых шагов
 * оформления. Сеть — шпион вместо Bot API.
 */
const TG = 42;

function botFor(state: Record<string, unknown>, modules: Record<string, boolean> = {}) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: { locale: "ru", ...state },
    },
  ];
  const ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules,
      settings: { default_locale: "ru" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  return { ctx, db, api, calls };
}

const from = { id: TG, is_bot: false, first_name: "A" };

function order(id: number, over: Record<string, unknown>) {
  return {
    id,
    order_no: id,
    telegram_id: TG,
    status: "delivered",
    total: 1000,
    currency: "KZT",
    created_at: `2026-09-${10 + id}T10:00:00Z`,
    fulfillment_kind: "digital",
    order_items: [{ name_snapshot: `Товар ${id}`, quantity: 1 }],
    ...over,
  };
}

function buttonsOf(calls: Array<[string, Record<string, unknown>]>): string[] {
  const sent = calls.filter(([m]) => m === "sendMessage").pop()?.[1];
  const kb = (sent?.reply_markup as { inline_keyboard?: Array<Array<{ callback_data: string }>> })
    ?.inline_keyboard;
  return (kb ?? []).flat().map((b) => b.callback_data);
}

describe("«Мои заказы» в боте", () => {
  it("оценить можно и выданный физический заказ, а повторная отправка файлов — только у цифрового", async () => {
    const { ctx, db, api, calls } = botFor({}, { review_request: true });
    db.tables.orders = [
      order(1, { fulfillment_kind: "physical" }),
      order(2, { fulfillment_kind: "digital" }),
    ];
    await handleTelegramUpdate(ctx, api, {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: TG, type: "private" },
        from,
        text: "📋 Мои заказы",
      },
    } as never);
    const buttons = buttonsOf(calls);
    expect(buttons).toContain("rate:1");
    expect(buttons).toContain("rate:2");
    expect(buttons).toContain("resend:2");
    expect(buttons).not.toContain("resend:1");
  });
});

describe("кнопка языка материалов до оформления", () => {
  const press = (data: string) =>
    ({
      update_id: 2,
      callback_query: {
        id: "cq-1",
        from,
        data,
        message: { message_id: 5, date: 0, chat: { id: TG, type: "private" } },
      },
    }) as never;

  it("старая кнопка checkoutlang: вне шага выбора языка ничего не делает", async () => {
    const { ctx, db, api, calls } = botFor({ mode: "idle", country_code: "KZ" });
    await handleTelegramUpdate(ctx, api, press("checkoutlang:kk"));
    expect(calls.map(([m]) => m)).toEqual(["answerCallbackQuery"]);
    const state = db.tables.bot_users![0]!.state as Record<string, unknown>;
    expect(state.mode).toBe("idle");
    expect(state.delivery_lang).toBeUndefined();
  });

  it("на шаге выбора языка кнопка принимается, и чужое значение отбрасывается", async () => {
    const bad = botFor({ mode: "awaiting_delivery_lang" });
    await handleTelegramUpdate(bad.ctx, bad.api, press("checkoutlang:xx"));
    expect(bad.calls.map(([m]) => m)).toEqual(["answerCallbackQuery"]);
    expect((bad.db.tables.bot_users![0]!.state as Record<string, unknown>).mode).toBe(
      "awaiting_delivery_lang",
    );

    const ok = botFor({ mode: "awaiting_delivery_lang" });
    await handleTelegramUpdate(ok.ctx, ok.api, press("checkoutlang:kk"));
    const state = ok.db.tables.bot_users![0]!.state as Record<string, unknown>;
    expect(state.delivery_lang).toBe("kk");
    expect(state.mode).not.toBe("awaiting_delivery_lang");
  });
});
