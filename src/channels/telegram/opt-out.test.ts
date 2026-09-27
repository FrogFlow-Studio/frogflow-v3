import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import type { BroadcastRow } from "@/core/broadcasts/broadcasts";
import { handleTelegramUpdate } from "./handle-update";
import { telegramBroadcastSender } from "./jobs";
import { COPY } from "./copy";
import type { TelegramApi } from "./api";

/** Отписка от рассылок в Telegram: кнопка под рассылкой, слово, /start. */
const TG = 42;
const KEY = userKey("telegram", TG);

function botFor(optOut: boolean, state: Record<string, unknown> = {}) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: KEY,
      platform: "telegram",
      telegram_id: TG,
      opt_out: optOut,
      state: { locale: "ru", ...state },
    },
  ];
  const ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules: {},
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
const texts = (calls: Array<[string, Record<string, unknown>]>) =>
  calls.filter(([m]) => m === "sendMessage").map(([, p]) => String(p.text));

function message(text: string) {
  return {
    update_id: 1,
    message: { message_id: 1, date: 0, chat: { id: TG, type: "private" }, from, text },
  } as never;
}

describe("отписка в Telegram", () => {
  it("кнопка «Отписаться» под рассылкой ставит opt_out и отвечает", async () => {
    const { ctx, db, api, calls } = botFor(false);
    await handleTelegramUpdate(ctx, api, {
      update_id: 1,
      callback_query: {
        id: "cq",
        from,
        data: "unsub",
        message: { message_id: 5, date: 0, chat: { id: TG, type: "private" } },
      },
    } as never);
    expect(db.tables.bot_users![0]!.opt_out).toBe(true);
    expect(texts(calls)).toContain(COPY.ru.unsubscribed);
  });

  it("слово «отписаться» вне оформления тоже отписывает", async () => {
    const { ctx, db, api } = botFor(false);
    await handleTelegramUpdate(ctx, api, message("Отписаться"));
    expect(db.tables.bot_users![0]!.opt_out).toBe(true);
  });

  it("на шаге оформления слово не отписывает", async () => {
    const { ctx, db, api } = botFor(false, { mode: "awaiting_contact" });
    await handleTelegramUpdate(ctx, api, message("стоп"));
    expect(db.tables.bot_users![0]!.opt_out).toBe(false);
  });

  it("/start возвращает отписавшегося и говорит об этом", async () => {
    const { ctx, db, api, calls } = botFor(true);
    await handleTelegramUpdate(ctx, api, message("/start"));
    expect(db.tables.bot_users![0]!.opt_out).toBe(false);
    expect(texts(calls)[0]).toBe(COPY.ru.resubscribed);
  });

  it("/start у подписанного — без лишнего сообщения", async () => {
    const { ctx, api, calls } = botFor(false);
    await handleTelegramUpdate(ctx, api, message("/start"));
    expect(texts(calls)).not.toContain(COPY.ru.resubscribed);
  });
});

describe("кнопка отписки в рассылке", () => {
  const broadcast = { id: "00000000-0000-0000-0000-000000000001" } as BroadcastRow;
  const content = { text: "Скидки!", photoKeys: [], productIds: [], showCatalog: false };

  it("под текстом рассылки — «Отписаться»", async () => {
    const { ctx, api, calls } = botFor(false);
    await telegramBroadcastSender(ctx, api)({ telegramId: TG, phone: null }, content, broadcast);
    const kb = calls[0]![1].reply_markup as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    expect(kb.inline_keyboard.flat().map((b) => b.callback_data)).toEqual(["unsub"]);
  });

  it("альбом: кнопка отдельным сообщением с понятной фразой", async () => {
    const { ctx, api, calls } = botFor(false);
    await telegramBroadcastSender(ctx, api)(
      { telegramId: TG, phone: null },
      { ...content, photoKeys: ["a.jpg", "b.jpg"] },
      broadcast,
    );
    expect(calls.map(([m]) => m)).toEqual(["sendMediaGroup", "sendMessage"]);
    expect(calls[1]![1].text).toBe(COPY.ru.unsubscribeHint);
  });
});
