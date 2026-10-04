import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import type { TelegramApi } from "./api";

// Ответ менеджера из Telegram на уведомление о передаче (v1 f9cc53d).
const sent: Array<{ conversationId: string; text: string }> = [];
let outcome: { ok: boolean; failure?: unknown } = { ok: true };
vi.mock("@/channels/zernio/outbound.server", async (orig) => ({
  ...(await orig<typeof import("@/channels/zernio/outbound.server")>()),
  sendToZernioTargetResult: async (t: { conversationId: string }, html: string) => {
    sent.push({ conversationId: t.conversationId, text: html });
    return outcome;
  },
}));
vi.mock("@/core/notify/recipients", () => ({ shopAdminIds: async () => ["42"] }));

const { handleTelegramUpdate } = await import("./handle-update");
const { issueHandoffRef, handoffRefLine } = await import("@/core/consultant/relay");

function bot() {
  const db: FakeDb = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.bot_users = [
    {
      id: "u-a",
      user_key: userKey("telegram", 42),
      platform: "telegram",
      telegram_id: 42,
      state: { locale: "ru" },
    },
    {
      id: "u-b",
      user_key: "ig_777",
      platform: "instagram",
      telegram_id: -777,
      zernio_conversation_id: "conv-777",
      zernio_account_id: "acc",
      state: {},
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

const msg = (from: number, text: string, replyTo: string) => ({
  update_id: 1,
  message: {
    message_id: 5,
    chat: { id: from, type: "private" },
    from: { id: from, is_bot: false, first_name: "M" },
    text,
    reply_to_message: { message_id: 3, text: replyTo },
  },
});

describe("ответ менеджера из Telegram", () => {
  it("ответ свайпом на уведомление уходит покупателю в Direct, пауза остаётся", async () => {
    const { ctx, db, api, calls } = bot();
    const ref = await issueHandoffRef(ctx, "ig_777");
    sent.length = 0;
    await handleTelegramUpdate(
      ctx,
      api,
      msg(42, "Добрый день, есть в наличии", `🙋 Клиент ждёт менеджера\n${handoffRefLine(ref)}`),
    );
    expect(sent).toEqual([{ conversationId: "conv-777", text: "Добрый день, есть в наличии" }]);
    const buyer = db.tables.bot_users!.find((u) => u.user_key === "ig_777")!;
    const c = (buyer.state as { consultant: { paused_until: string; relayed: string[] } })
      .consultant;
    expect(Date.parse(c.paused_until)).toBeGreaterThan(Date.now());
    expect(c.relayed).toEqual(["Добрый день, есть в наличии"]);
    expect(String(calls.at(-1)?.[1].text)).toContain("отправлен покупателю");
  });

  it("не продавец или сообщение без метки — обычная обработка, покупателю ничего", async () => {
    const { ctx, api } = bot();
    const ref = await issueHandoffRef(ctx, "ig_777");
    sent.length = 0;
    await handleTelegramUpdate(ctx, api, msg(99, "привет", handoffRefLine(ref)));
    await handleTelegramUpdate(ctx, api, msg(42, "привет", "обычное сообщение"));
    expect(sent).toEqual([]);
  });

  it("Б9: окно WhatsApp закрыто — продавцу «ответьте шаблоном», повтора нет, ответ не записан как отправленный", async () => {
    const { ctx, db, api, calls } = bot();
    const wa = db.tables.bot_users!.find((u) => u.user_key === "ig_777")!;
    wa.platform = "whatsapp";
    const ref = await issueHandoffRef(ctx, "ig_777");
    sent.length = 0;
    outcome = { ok: false, failure: { status: 400, platformCode: 131047 } };
    await handleTelegramUpdate(ctx, api, msg(42, "Добрый день", handoffRefLine(ref)));
    outcome = { ok: true };
    expect(sent).toHaveLength(1);
    expect(String(calls.at(-1)?.[1].text)).toContain("окно WhatsApp закрыто");
    expect(String(calls.at(-1)?.[1].text)).toContain("шаблоном");
    const c = (wa.state as { consultant?: { relayed?: string[] } }).consultant;
    expect(c?.relayed ?? []).toEqual([]);
  });

  it("Б9: обрыв связи — «неизвестно, дошло ли», без повторной отправки", async () => {
    const { ctx, api, calls } = bot();
    const ref = await issueHandoffRef(ctx, "ig_777");
    sent.length = 0;
    outcome = { ok: false, failure: { status: null } };
    await handleTelegramUpdate(ctx, api, msg(42, "Добрый день", handoffRefLine(ref)));
    outcome = { ok: true };
    expect(sent).toHaveLength(1);
    expect(String(calls.at(-1)?.[1].text)).toContain("Неизвестно, дошло ли");
  });

  it("Б9: отказ без шансов дойти — просто «не удалось»", async () => {
    const { ctx, api, calls } = bot();
    const ref = await issueHandoffRef(ctx, "ig_777");
    outcome = { ok: false, failure: { status: 403 } };
    await handleTelegramUpdate(ctx, api, msg(42, "Добрый день", handoffRefLine(ref)));
    outcome = { ok: true };
    expect(String(calls.at(-1)?.[1].text)).toContain("Не удалось отправить");
  });
});
