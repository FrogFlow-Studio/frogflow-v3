import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { BroadcastRow } from "@/core/broadcasts/broadcasts";
import { telegramBroadcastSender } from "./jobs";
import { COPY } from "./copy";
import type { TelegramApi } from "./api";

/** Н4: объявление об акции приходит на языке покупателя, а не магазина. */
const TEXTS = { ru: "Акция по-русски", kk: "Акция қазақша", en: "Sale in English" };
const broadcast = {
  id: "00000000-0000-0000-0000-000000000001",
  message_text: TEXTS.ru,
  audience_filter: { texts: TEXTS },
} as unknown as BroadcastRow;
const content = { text: TEXTS.ru, photoKeys: [], productIds: [], showCatalog: false };

function setup(locale: string | undefined) {
  const db = fakeDb();
  db.tables.bot_users = [
    { user_key: "tg:7", telegram_id: 7, state: locale ? { locale } : {}, opt_out: false },
  ];
  const ctx = {
    tenant: { id: "bot-1", modules: {}, settings: { default_locale: "ru" } },
    db,
  } as unknown as TenantContext;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: vi.fn(async (m: string, p: Record<string, unknown> = {}) => {
      calls.push([m, p]);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  return { ctx, api, calls };
}

describe("рассылка с текстами по языкам", () => {
  it("покупатель на kk получает текст на kk и кнопку отписки на kk", async () => {
    const { ctx, api, calls } = setup("kk");
    await telegramBroadcastSender(ctx, api)({ telegramId: 7, phone: null }, content, broadcast);
    expect(calls[0]![1].text).toBe(TEXTS.kk);
    const kb = calls[0]![1].reply_markup as { inline_keyboard: Array<Array<{ text: string }>> };
    expect(kb.inline_keyboard.flat().map((b) => b.text)).toEqual([COPY.kk.unsubscribeBtn]);
  });

  it("языка нет или текста на нём нет — общий текст на языке магазина", async () => {
    for (const locale of [undefined, "uz"]) {
      const { ctx, api, calls } = setup(locale);
      await telegramBroadcastSender(ctx, api)({ telegramId: 7, phone: null }, content, broadcast);
      expect(calls[0]![1].text).toBe(TEXTS.ru);
    }
  });

  it("обычная рассылка без текстов по языкам идёт как раньше", async () => {
    const { ctx, api, calls } = setup("kk");
    await telegramBroadcastSender(ctx, api)({ telegramId: 7, phone: null }, content, {
      ...broadcast,
      audience_filter: {},
    } as unknown as BroadcastRow);
    expect(calls[0]![1].text).toBe(TEXTS.ru);
  });
});
