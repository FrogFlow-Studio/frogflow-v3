import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../tests/fake-db";
import {
  QUIZ_ANSWERS,
  QUIZ_EXPECTED,
  QUIZ_JSON,
  QUIZ_TENANT,
  quizProducts,
} from "../../tests/quiz-fixture";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "./zernio/message";
import type { ZernioTransport } from "./zernio/api.server";
import type { TelegramApi } from "./telegram/api";
import { handleShopMessage } from "./zernio/shop.server";
import { matchDirectCommand } from "./zernio/shop-flow";
import { handleTelegramUpdate } from "./telegram/handle-update";

/**
 * Квиз-подбор в трёх каналах: Telegram, Instagram/WhatsApp (Direct) и сайт. Подсчёт
 * ответов один, в core/quiz, поэтому одинаковые ответы дают одинаковые товары.
 */
function world(opts: { quiz?: boolean } = {}) {
  const db: FakeDb = fakeDb();
  db.tables.app_settings = [
    ...(opts.quiz === false ? [] : [{ bot_id: QUIZ_TENANT, key: "quiz", value: QUIZ_JSON }]),
    { bot_id: QUIZ_TENANT, key: "shop_currency", value: "KZT" },
  ];
  db.tables.products = quizProducts();
  db.tables.categories = [];
  db.tables.payment_methods = [];
  db.tables.bot_users = [
    {
      user_key: "ig_1",
      platform: "instagram",
      telegram_id: -1,
      loyalty_points: 0,
      state: { locale: "ru", mode: "idle", country_code: "KZ", country_name: "Казахстан" },
    },
    {
      user_key: "telegram_42",
      platform: "telegram",
      telegram_id: 42,
      loyalty_points: 0,
      state: { locale: "ru", mode: "idle" },
    },
  ];
  const ctx = {
    tenant: {
      id: QUIZ_TENANT,
      status: "active",
      vertical: "digital",
      modules: { quiz: true, stock: true },
      settings: { default_locale: "ru" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { db, ctx };
}

function direct(w: ReturnType<typeof world>, platform: "instagram" | "whatsapp" = "instagram") {
  const sent: Array<{ text: string; interactive?: unknown }> = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string, o?: { interactive?: unknown }) => {
      sent.push({ text, interactive: o?.interactive });
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
  } as unknown as ZernioTransport;
  const row = () => w.db.tables.bot_users!.find((u) => u.user_key === "ig_1")!;
  const say = async (text: string) => {
    const c = {
      userKey: "ig_1",
      platform,
      telegramId: -1,
      loyaltyPoints: 0,
      state: row().state,
    } as unknown as Customer;
    await handleShopMessage(
      w.ctx,
      c,
      {
        conversationId: "conv-1",
        accountId: "acc-1",
        platform,
        text,
        postbackPayload: null,
        nativeOrder: null,
        attachments: [],
      } as unknown as ParsedZernioMessage,
      transport,
    );
  };
  const state = () =>
    row().state as Record<string, unknown> & { direct?: { list?: { ids: string[] } } };
  return { say, sent, state };
}

describe("квиз в Instagram и WhatsApp", () => {
  it("слово «подбор» запускает квиз, на любом из четырёх языков", () => {
    for (const w of ["Подбор", "подобрать товар", "іріктеу", "quiz", "Pick for me", "kviz"])
      expect(matchDirectCommand(w), w).toBe("quiz");
    expect(matchDirectCommand("а подбор будет?")).toBeNull();
  });

  it("вопросы по одному с номерами, ответы номерами, в конце — товары", async () => {
    const w = world();
    const d = direct(w);
    await d.say("подбор");
    expect(d.sent.map((m) => m.text).join("\n")).toContain("Подберём за минуту");
    expect(d.sent.at(-1)!.text).toContain("1/2. Для кого?");
    expect(d.sent.at(-1)!.text).toContain("1. Детям");
    expect(d.sent.at(-1)!.text).toContain("2. Взрослым");
    expect(d.state().mode).toBe("awaiting_quiz");
    await d.say("1");
    expect(d.sent.at(-1)!.text).toContain("2/2. Что нужно?");
    await d.say("1");
    expect(d.state().mode).toBe("idle");
    expect(d.state().direct?.list?.ids).toEqual(QUIZ_EXPECTED);
    expect(d.sent.map((m) => m.text).join("\n")).toContain("Вот что вам подойдёт");
  });

  it("WhatsApp: вопрос — списком, строки обрезаны под 24 символа", async () => {
    const w = world();
    const d = direct(w, "whatsapp");
    await d.say("подбор");
    const last = d.sent.at(-1)!.interactive as {
      action: { sections: Array<{ rows: Array<{ id: string; title: string }> }> };
    };
    expect(last.action.sections[0]!.rows.map((r) => r.id)).toEqual(["STEP:1", "STEP:2"]);
    for (const r of last.action.sections[0]!.rows) expect(r.title.length).toBeLessThanOrEqual(24);
  });

  it("не номер — вопрос повторяется; квиз не настроен — «подбор не настроен»", async () => {
    const w = world();
    const d = direct(w);
    await d.say("подбор");
    await d.say("не знаю");
    expect(d.sent.at(-1)!.text).toContain("1/2. Для кого?");
    expect(d.state().mode).toBe("awaiting_quiz");
    await d.say("9");
    expect(d.sent.at(-1)!.text).toContain("1/2. Для кого?");

    const off = world({ quiz: false });
    const e = direct(off);
    await e.say("подбор");
    expect(e.sent.at(-1)!.text).toContain("Подбор ещё не настроен");
    expect(e.state().mode).toBe("idle");
  });
});

describe("квиз в Telegram и в Direct дают одно и то же", () => {
  it("те же ответы — те же товары в том же порядке", async () => {
    // Telegram: кнопки quiz:<вопрос>:<вариант>.
    const w = world();
    const calls: Array<[string, Record<string, unknown>]> = [];
    const api = {
      call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
        calls.push([method, payload]);
        return { ok: true, result: {} };
      }),
    } as unknown as TelegramApi;
    const from = { id: 42, is_bot: false, first_name: "Аня" };
    const chat = { id: 42, type: "private" };
    let n = 0;
    for (const [q, i] of QUIZ_ANSWERS.entries())
      await handleTelegramUpdate(w.ctx, api, {
        update_id: ++n,
        callback_query: {
          id: `cq${n}`,
          from,
          data: `quiz:${q}:${i}`,
          message: { message_id: 9, date: 0, chat },
        },
      } as never);
    const last = calls.filter(([m]) => m === "sendMessage").at(-1)![1];
    const tgIds = (
      (last.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> })
        .inline_keyboard ?? []
    )
      .flat()
      .map((b) => b.callback_data.replace("prod:", ""));
    expect(tgIds).toEqual(QUIZ_EXPECTED);

    // Direct: те же ответы цифрами 1-based.
    const d = direct(world());
    await d.say("подбор");
    for (const i of QUIZ_ANSWERS) await d.say(String(i + 1));
    expect(d.state().direct?.list?.ids).toEqual(tgIds);
  });
});
