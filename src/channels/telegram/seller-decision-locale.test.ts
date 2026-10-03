import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { handleTelegramUpdate } from "./handle-update";
import { SELLER_DECISION } from "./seller-decision-texts";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import type { TelegramApi } from "./api";

const BOT = "bot-1";

function setup(adminLocale: string) {
  const db: FakeDb = fakeDb();
  db.tables.app_settings = [
    { bot_id: BOT, key: "admin_chat_id", value: "111" },
    { bot_id: BOT, key: "admin_locale", value: adminLocale },
  ];
  db.tables.orders = [
    {
      id: 7,
      order_no: 7,
      bot_id: BOT,
      telegram_id: 42,
      platform: "telegram",
      status: "awaiting_confirmation",
      total: 1000,
      currency: "KZT",
      fulfillment_kind: "digital",
      order_items: [],
    },
  ];
  const ctx = {
    tenant: { id: BOT, status: "active", modules: {}, settings: { default_locale: "ru" } },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const sent: string[] = [];
  const api = {
    call: vi.fn(async (method: string, p: Record<string, unknown>) => {
      if (method === "sendMessage" && p.chat_id === 111) sent.push(String(p.text));
      return { ok: true, result: method.startsWith("send") ? { message_id: 1 } : true };
    }),
  } as unknown as TelegramApi;
  const press = (fromId: number, data: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 1,
      callback_query: {
        id: "cq",
        from: { id: fromId, is_bot: false, first_name: "S" },
        data,
        message: { message_id: 500, date: 0, chat: { id: 111, type: "private" } },
      },
    } as never);
  return { press, sent };
}

describe("кнопки продавца в Telegram отвечают на языке продавца (О3)", () => {
  for (const l of SUPPORTED_LOCALES) {
    it(`${l}: «Отклонить» и «нет такого заказа»`, async () => {
      const { press, sent } = setup(l);
      await press(111, "reject:7");
      await press(111, "confirm:999");
      expect(sent).toEqual([SELLER_DECISION[l].rejected(7), SELLER_DECISION[l].notFound(999)]);
    });
  }

  it("kk/en/uz — не русский текст, чужой нажавший получает ответ на языке магазина", async () => {
    for (const l of ["kk", "en", "uz"] as const) {
      const { press, sent } = setup(l);
      await press(111, "reject:7");
      expect(sent[0]).not.toBe(SELLER_DECISION.ru.rejected(7));
      expect(sent[0]).not.toMatch(/отклонён/);
    }
    const { press, sent } = setup("en");
    await press(555, "reject:7");
    expect(sent).toEqual([SELLER_DECISION.en.onlyAdmin]);
  });

  it("словари полные: те же поля и без пустых строк на каждом языке", () => {
    const keys = Object.keys(SELLER_DECISION.ru).sort();
    for (const l of SUPPORTED_LOCALES) {
      expect(Object.keys(SELLER_DECISION[l]).sort()).toEqual(keys);
    }
  });
});
