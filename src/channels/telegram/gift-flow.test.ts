import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate } from "./handle-update";
import type { TelegramApi } from "./api";

/** «Это подарок» в корзине Telegram: кнопка, имя, открытка, пропуск, снятие отметки. */
const TG = 42;
const from = { id: TG, is_bot: false, first_name: "A" };

function bot(modules: Record<string, boolean> = { bundles: true }) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: { locale: "ru", country_code: "KZ" },
    },
  ];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-10-01T00:00:00Z",
      products: {
        id: "p-1",
        name: "Торт",
        price: 5000,
        currency: "KZT",
        fulfillment_kind: "physical",
        stock_quantity: null,
      },
      product_variants: null,
    },
  ];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
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
  let n = 0;
  const press = (data: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: ++n,
      callback_query: {
        id: `cq${n}`,
        from,
        data,
        message: { message_id: 1, date: 0, chat: { id: TG, type: "private" } },
      },
    } as never);
  const say = (text: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: ++n,
      message: { message_id: 10 + n, date: 0, from, chat: { id: TG, type: "private" }, text },
    } as never);
  const state = () => db.tables.bot_users![0]!.state as Record<string, unknown>;
  const sent = () => calls.filter(([m]) => m === "sendMessage").map(([, p]) => String(p.text));
  const lastText = () => String(calls.filter(([m]) => m === "sendMessage").pop()?.[1].text ?? "");
  const lastButtons = () =>
    (
      (
        calls.filter(([m]) => m === "sendMessage").pop()?.[1].reply_markup as
          { inline_keyboard?: Array<Array<{ callback_data: string }>> } | undefined
      )?.inline_keyboard ?? []
    )
      .flat()
      .map((b) => b.callback_data);
  return { db, press, say, state, lastText, lastButtons, sent };
}

describe("«Это подарок» в корзине Telegram", () => {
  it("кнопка → имя → открытка: корзина показывает подарок, state хранит данные", async () => {
    const b = bot();
    await b.press("gift:clear"); // показывает корзину
    expect(b.lastButtons()).toContain("gift:enter");
    await b.press("gift:enter");
    expect(b.state().mode).toBe("awaiting_gift_recipient");
    await b.say("Анна");
    expect(b.state()).toMatchObject({ mode: "awaiting_gift_message", gift_recipient: "Анна" });
    expect(b.lastButtons()).toContain("gift:skip");
    await b.say("С днём рождения!");
    expect(b.state()).toMatchObject({
      mode: "idle",
      gift_on: true,
      gift_recipient: "Анна",
      gift_message: "С днём рождения!",
    });
    expect(b.lastText()).toContain("🎁 Подарок для Анна");
    expect(b.lastText()).toContain("«С днём рождения!»");
    expect(b.lastButtons()).toContain("gift:clear");
  });

  it("«Пропустить» оставляет подарок без открытки, «Убрать» снимает отметку", async () => {
    const b = bot();
    await b.press("gift:enter");
    await b.say("Анна");
    await b.press("gift:skip");
    expect(b.state()).toMatchObject({ mode: "idle", gift_on: true, gift_recipient: "Анна" });
    expect(b.state().gift_message).toBeUndefined();
    await b.press("gift:clear");
    expect(b.state().gift_on).toBeUndefined();
    expect(b.state().gift_recipient).toBeUndefined();
    expect(b.lastText()).not.toContain("🎁 Подарок");
  });

  it("длинная открытка режется до 300 и покупателю сказано об этом", async () => {
    const b = bot();
    await b.press("gift:enter");
    await b.say("Анна");
    await b.say("я".repeat(350));
    expect(Array.from(String(b.state().gift_message))).toHaveLength(300);
    // Покупателю сказано, что текст обрезан, а не молча.
    expect(b.sent().some((t) => t.includes("Текст длиннее 300 символов"))).toBe(true);
  });

  it("модуль выключен — кнопки подарка в корзине нет и «gift:enter» ничего не включает", async () => {
    const b = bot({});
    await b.press("gift:clear"); // показывает корзину
    expect(b.lastButtons()).not.toContain("gift:enter");
    await b.press("gift:enter");
    expect(b.state().mode).toBeUndefined();
  });
});
