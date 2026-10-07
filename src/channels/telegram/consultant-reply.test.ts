import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import type { TelegramApi } from "./api";

/**
 * ИИ-консультант в Telegram: строка журнала ответов на каждое сообщение (как в
 * Direct) и уведомление о передаче всем продавцам, даже если один недоступен.
 */

const TG = 42;
vi.mock("@/core/notify/recipients", () => ({
  adminRecipients: async () => ["901", "902"],
  shopAdminIds: async () => ["901", "902"],
}));
const engine = { result: null as unknown, paused: false };
vi.mock("@/core/consultant/engine.server", async (orig) => ({
  ...(await orig<typeof import("@/core/consultant/engine.server")>()),
  consultantEnabled: async () => true,
  isPaused: () => engine.paused,
  runConsultant: vi.fn(async () => engine.result),
}));
vi.mock("@/core/pipeline/sources", () => ({ leadFromHandoff: vi.fn(async () => {}) }));

const { handleTelegramUpdate } = await import("./handle-update");

let db: FakeDb;
let ctx: TenantContext;
let calls: Array<[string, Record<string, unknown>]>;
let api: TelegramApi;
beforeEach(() => {
  setEnvForTests({});
  db = fakeDb({ unique: { consultant_message_runs: [["bot_id", "message_id"]] } });
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      opt_out: false,
      state: { locale: "ru" },
    },
  ];
  db.tables.products = [];
  db.tables.categories = [];
  db.tables.app_settings = [];
  db.tables.consultant_message_runs = [];
  ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "consultant",
      modules: {},
      settings: { default_locale: "ru" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  calls = [];
  api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      // Первый продавец заблокировал бота: вызов падает исключением.
      if (method === "sendMessage" && payload.chat_id === "901") throw new Error("обрыв");
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  engine.paused = false;
});
afterEach(() => setEnvForTests(undefined));

const say = (text: string, messageId = 7) =>
  handleTelegramUpdate(ctx, api, {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: 0,
      chat: { id: TG, type: "private" },
      from: { id: TG, is_bot: false, first_name: "Аня" },
      text,
    },
  } as never);
const usage = { inputTokens: 10, outputTokens: 5, usd: 0.0002 };
const runs = () => db.tables.consultant_message_runs!;

describe("консультант в Telegram", () => {
  it("ответ — строка журнала с ценой ответа и ключом сообщения", async () => {
    engine.result = { reply: "Есть, 9 000 ₸.", handoff: null, usage, model: "m", tools: ["x"] };
    await say("Есть полотенца?");
    expect(calls.some(([m, p]) => m === "sendMessage" && p.text === "Есть, 9 000 ₸.")).toBe(true);
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({
      message_id: `tg:${TG}:7`,
      conversation_id: String(TG),
      status: "replied",
      reply_text: "Есть, 9 000 ₸.",
      reply_kind: "reply",
      model: "m",
    });
    expect((runs()[0]!.token_usage as { usd: number }).usd).toBe(0.0002);
  });

  it("передача — уведомление второму продавцу, хотя первому не ушло", async () => {
    engine.result = {
      reply: "Передаю менеджеру.",
      handoff: { kind: "handoff", reason: "human_requested", summary: "Просит человека" },
      usage,
    };
    await expect(say("Позовите менеджера")).resolves.not.toThrow();
    const toSellers = calls.filter(([m, p]) => m === "sendMessage" && p.chat_id !== TG);
    expect(toSellers.map(([, p]) => p.chat_id)).toEqual(["901", "902"]);
    expect(String(toSellers[1]![1].text)).toContain("Клиент ждёт менеджера");
    expect(runs()[0]).toMatchObject({ reply_kind: "handoff:human_requested" });
  });

  it("на паузе — бот молчит, в журнале строка cancelled", async () => {
    engine.paused = true;
    await say("Ещё вопрос", 8);
    expect(calls.filter(([m]) => m === "sendMessage")).toHaveLength(0);
    expect(runs()[0]).toMatchObject({
      message_id: `tg:${TG}:8`,
      status: "cancelled",
      reply_kind: "paused",
    });
  });
});
