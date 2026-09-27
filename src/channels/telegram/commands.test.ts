import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate } from "./handle-update";
import { COPY } from "./copy";
import type { TelegramApi } from "./api";
import {
  botCommandFor,
  botCommandList,
  botCommandsVersion,
  clearBotCommands,
  syncBotCommands,
} from "./commands";

/** Меню команд бота: список на языках покупателей и обработчики команд. */
const TG = 42;

function apiSpy() {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  return { api, calls };
}

const tenant = (modules: Record<string, boolean> = {}, defaultLocale = "ru") =>
  ({ id: "bot-1", modules, settings: { default_locale: defaultLocale } }) as unknown as Tenant;

function botFor(state: Record<string, unknown> = {}, modules: Record<string, boolean> = {}) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      opt_out: false,
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
  return { ctx, db, ...apiSpy() };
}

const from = { id: TG, is_bot: false, first_name: "A", language_code: "ru" };
const message = (text: string) =>
  ({
    update_id: 1,
    message: { message_id: 1, date: 0, chat: { id: TG, type: "private" }, from, text },
  }) as never;
const texts = (calls: Array<[string, Record<string, unknown>]>) =>
  calls.filter(([m]) => m === "sendMessage").map(([, p]) => String(p.text));

describe("меню команд: список", () => {
  it("команда распознаётся и с именем бота, чужие — нет", () => {
    expect(botCommandFor("/catalog")).toBe("catalog");
    expect(botCommandFor(" /CART ")).toBe("cart");
    expect(botCommandFor("/orders@shop_bot")).toBe("orders");
    expect(botCommandFor("/language")).toBe("language");
    expect(botCommandFor("/stop")).toBe("stop");
    expect(botCommandFor("/start")).toBeNull();
    expect(botCommandFor("/catalog лишнее")).toBeNull();
    expect(botCommandFor("catalog")).toBeNull();
    expect(botCommandFor(undefined)).toBeNull();
  });

  it("/language — только с модулем «Несколько языков»", () => {
    expect(botCommandList(tenant(), "ru").map((c) => c.command)).toEqual([
      "catalog",
      "cart",
      "orders",
      "stop",
    ]);
    expect(botCommandList(tenant({ multi_language: true }), "ru").map((c) => c.command)).toEqual([
      "catalog",
      "cart",
      "orders",
      "language",
      "stop",
    ]);
    expect(botCommandsVersion(tenant())).not.toBe(
      botCommandsVersion(tenant({ multi_language: true })),
    );
  });

  it("ставится на каждый язык покупателя и по умолчанию — на языке магазина", async () => {
    const { api, calls } = apiSpy();
    await syncBotCommands(tenant({}, "kk"), api);
    expect(calls.map(([m]) => m)).toEqual(Array(5).fill("setMyCommands"));
    const [def, ...langs] = calls.map(([, p]) => p);
    expect(def!.language_code).toBeUndefined();
    expect((def!.commands as Array<{ description: string }>)[1]!.description).toBe("Себет");
    expect(langs.map((p) => p.language_code)).toEqual(["ru", "kk", "en", "uz"]);
    const en = langs.find((p) => p.language_code === "en")!;
    expect((en.commands as Array<{ description: string }>)[2]!.description).toBe("My orders");
  });

  it("отказ Telegram — ошибка, а не молчаливое «готово»", async () => {
    const api = { call: vi.fn(async () => ({ ok: false, description: "Bad Request" })) };
    await expect(syncBotCommands(tenant(), api as unknown as TelegramApi)).rejects.toThrow(
      /Bad Request/,
    );
  });

  it("откат на v1 убирает меню на всех языках", async () => {
    const { api, calls } = apiSpy();
    await clearBotCommands(api);
    expect(calls).toEqual([
      ["deleteMyCommands", {}],
      ["deleteMyCommands", { language_code: "ru" }],
      ["deleteMyCommands", { language_code: "kk" }],
      ["deleteMyCommands", { language_code: "en" }],
      ["deleteMyCommands", { language_code: "uz" }],
    ]);
  });
});

describe("меню команд: обработчики", () => {
  it("/cart показывает корзину и сбрасывает незаконченный шаг оформления", async () => {
    const { ctx, db, api, calls } = botFor({ mode: "awaiting_address" });
    await handleTelegramUpdate(ctx, api, message("/cart"));
    expect(texts(calls)).toContain(COPY.ru.cartEmpty);
    expect((db.tables.bot_users![0]!.state as { mode: string }).mode).toBe("idle");
  });

  it("/orders — «Мои заказы»", async () => {
    const { ctx, api, calls } = botFor();
    await handleTelegramUpdate(ctx, api, message("/orders@shop_bot"));
    expect(texts(calls)).toContain(COPY.ru.myOrdersEmpty);
  });

  it("/catalog открывает каталог, а не «выберите в меню»", async () => {
    const { ctx, api, calls } = botFor();
    await handleTelegramUpdate(ctx, api, message("/catalog"));
    expect(texts(calls).length).toBeGreaterThan(0);
    expect(texts(calls)).not.toContain(COPY.ru.useMenu);
  });

  it("/language — выбор языка с модулем, без модуля — главное меню", async () => {
    const on = botFor({}, { multi_language: true });
    await handleTelegramUpdate(on.ctx, on.api, message("/language"));
    expect(texts(on.calls)).toEqual([COPY.ru.chooseLanguage]);

    const off = botFor();
    await handleTelegramUpdate(off.ctx, off.api, message("/language"));
    expect(texts(off.calls)).toEqual([COPY.ru.chooseSection]);
  });

  it("/stop отписывает и посреди оформления", async () => {
    const { ctx, db, api, calls } = botFor({ mode: "awaiting_contact" });
    await handleTelegramUpdate(ctx, api, message("/stop"));
    expect(db.tables.bot_users![0]!.opt_out).toBe(true);
    expect(texts(calls)).toContain(COPY.ru.unsubscribed);
  });
});
