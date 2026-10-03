import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { failedReason, handleMessageFailed } from "./message-failed.server";

const chat: Array<{ telegramId: number; sender: string; text: string }> = [];
const admin: Array<{ text: string; opts: unknown }> = [];
vi.mock("@/core/chat/chat", () => ({
  recordMessage: async (_ctx: unknown, p: { telegramId: number; sender: string; text: string }) => {
    chat.push(p);
  },
}));
vi.mock("@/channels/telegram/notify", () => ({
  notifyAdminsHtml: async (_ctx: unknown, text: string, opts: unknown) => {
    admin.push({ text, opts });
    return 1;
  },
}));

const BOT = "00000000-0000-0000-0000-0000000000ff";

function setup(modules: Record<string, boolean> = { manager_chat: true }) {
  const db = fakeDb();
  db.tables.bot_users = [
    {
      id: "u1",
      bot_id: BOT,
      user_key: "wa_77011234567",
      telegram_id: -501,
      zernio_conversation_id: "conv-1",
      state: {},
    },
  ];
  db.tables.orders = [
    {
      id: 11,
      bot_id: BOT,
      telegram_id: -501,
      status: "delivered",
      display_no: 1057,
      order_no: 57,
      created_at: new Date().toISOString(),
    },
  ];
  db.tables.order_items = [{ id: 1, bot_id: BOT, order_id: 11, name_snapshot: "Курс «Пазлы»" }];
  const ctx = { tenant: { id: BOT, modules, settings: {} }, db } as unknown as TenantContext;
  return { ctx, db };
}

const failed = (text: string, code: number | string = 131026) => ({
  event: "message.failed",
  message: { conversationId: "conv-1", text, platformMessageId: "wamid.1" },
  conversation: { id: "conv-1" },
  error: { code, title: "Message undeliverable", message: "…" },
});

beforeEach(() => {
  chat.length = 0;
  admin.length = 0;
});

describe("message.failed: WhatsApp не доставил после ответа 200", () => {
  it("ответ продавца: в «Чате» пометка «не доставлено» с причиной, продавцу не пишем", async () => {
    const { ctx } = setup();
    const r = await handleMessageFailed(ctx, failed("Здравствуйте! Заказ готов"));
    expect(chat).toEqual([
      expect.objectContaining({
        telegramId: -501,
        sender: "bot",
        text: expect.stringMatching(
          /^⚠️ Не доставлено: «Здравствуйте! Заказ готов»\. Причина: номер/,
        ),
      }),
    ]);
    expect(admin).toHaveLength(0);
    expect(r.note).toContain("пометка");
  });

  it("не дошли материалы заказа — продавцу уведомление с номером заказа", async () => {
    const { ctx } = setup();
    await handleMessageFailed(ctx, failed("📁 Курс «Пазлы»\nhttps://files.test/a.pdf"));
    expect(admin).toHaveLength(1);
    expect(admin[0]!.text).toContain("Заказ #1057");
    expect(admin[0]!.text).toContain("Курс «Пазлы»");
    expect(admin[0]!.opts).toMatchObject({ orderId: 11, kind: "delivery_failure" });
  });

  it("материалы с чужим названием или старый заказ — продавцу не пишем", async () => {
    const { ctx, db } = setup();
    await handleMessageFailed(ctx, failed("📁 Другой товар\nhttps://files.test/b.pdf"));
    expect(admin).toHaveLength(0);
    db.tables.orders![0]!.created_at = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await handleMessageFailed(ctx, failed("📁 Курс «Пазлы»\nhttps://files.test/a.pdf"));
    expect(admin).toHaveLength(0);
  });

  it("модуль «Чат» выключен — пометки нет, но про заказ продавцу пишем", async () => {
    const { ctx } = setup({});
    await handleMessageFailed(ctx, failed("📁 Курс «Пазлы»\nhttps://files.test/a.pdf"));
    expect(chat).toHaveLength(0);
    expect(admin).toHaveLength(1);
  });

  it("покупателя с таким диалогом нет — ничего не пишем", async () => {
    const { ctx } = setup();
    const r = await handleMessageFailed(ctx, {
      ...failed("привет"),
      message: { conversationId: "conv-x", text: "привет" },
      conversation: { id: "conv-x" },
    });
    expect(r.note).toBe("покупатель не найден");
    expect(chat).toHaveLength(0);
  });

  it("причина — по коду Meta через классификатор", () => {
    expect(failedReason({ code: 131047 })).toMatch(/24 часов/);
    expect(failedReason({ code: "131026" })).toMatch(/не принимает/);
    expect(failedReason({ code: 131056 })).toMatch(/частоту/);
    expect(failedReason({ code: 999 })).toBe("WhatsApp не доставил сообщение (код 999)");
    expect(failedReason(null)).toBe("WhatsApp не доставил сообщение");
  });
});

describe("message.failed: заказ покупателя не теряется среди многих", () => {
  it("нужный заказ — двадцать пятый за окно: продавцу всё равно пишем", async () => {
    const { ctx, db } = setup();
    const now = Date.now();
    db.tables.orders = Array.from({ length: 25 }, (_, i) => ({
      id: 100 + i,
      bot_id: BOT,
      telegram_id: -501,
      status: "delivered",
      display_no: 2000 + i,
      order_no: i,
      created_at: new Date(now - (i + 1) * 60_000).toISOString(),
    }));
    // нужная позиция — только в самом старом (двадцать пятом) заказе
    db.tables.order_items = [{ id: 1, bot_id: BOT, order_id: 124, name_snapshot: "Курс «Пазлы»" }];
    await handleMessageFailed(ctx, failed("📁 Курс «Пазлы»\nhttps://files.test/a.pdf"));
    expect(admin).toHaveLength(1);
    expect(admin[0]!.text).toContain("Заказ #2024");
  });
});
