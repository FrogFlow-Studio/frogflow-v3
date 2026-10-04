import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ZernioTransport } from "./api.server";
import type { ParsedZernioMessage } from "./message";
import { nonTextKind } from "./nontext";

/** Б6: голосовое, стикер и фото вне оплаты — понятный ответ, а не молчание. */

const notifySeller = vi.hoisted(() => vi.fn(async (_c: unknown, _h: string, _o?: unknown) => 1));
vi.mock("@/channels/telegram/notify", async (orig) => ({
  ...(await orig<typeof import("@/channels/telegram/notify")>()),
  notifyAdminsHtml: notifySeller,
}));
vi.mock("@/core/catalog/low-stock", () => ({ sellerLocale: async () => "ru" }));

const { handleShopMessage } = await import("./shop.server");

// Настоящий consultantEnabled: ключа ИИ в окружении нет — консультант выключен.
beforeEach(() => setEnvForTests({}));
afterEach(() => setEnvForTests(undefined));

function setup(state: Record<string, unknown>, settings: Array<Record<string, unknown>> = []) {
  const db = fakeDb();
  db.tables.app_settings = settings;
  db.tables.bot_users = [
    { user_key: "ig_1", bot_id: "bot-1", platform: "instagram", telegram_id: -1, state },
  ];
  db.tables.orders = [];
  db.tables.cart_items = [];
  const ctx = {
    tenant: { id: "bot-1", status: "active", vertical: "digital", modules: {}, settings: {} },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const customer = () =>
    ({
      userKey: "ig_1",
      platform: "instagram",
      telegramId: -1,
      username: "anna",
      firstName: "Анна",
      loyaltyPoints: 0,
      state: db.tables.bot_users![0]!.state,
    }) as unknown as Customer;
  const sent: string[] = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
    download: vi.fn(async () => null),
    mailReady: () => false,
  } as unknown as ZernioTransport;
  const send = (attachments: Array<Record<string, unknown>>) =>
    handleShopMessage(
      ctx,
      customer(),
      {
        conversationId: "c1",
        accountId: "a1",
        platform: "instagram",
        senderId: "1",
        text: "",
        postbackPayload: null,
        nativeOrder: null,
        attachments,
        mediaWithoutUrl: false,
      } as unknown as ParsedZernioMessage,
      transport,
    );
  return { send, sent };
}

const talking = () => ({
  locale: "ru",
  direct: { last_reply: "Каталог", last_reply_at: new Date().toISOString() },
});
const voice = [{ type: "audio", url: "https://cdn/v.ogg", index: 0 }];
const sticker = [{ type: "sticker", url: "https://cdn/s.webp", index: 0 }];
const photo = [{ type: "image", url: "https://cdn/p.jpg", index: 0 }];

describe("вид сообщения без текста", () => {
  it("голос, стикер, видео, фото; пересланный пост и сторис — не наше", () => {
    expect(nonTextKind([{ type: "audio" }])).toBe("voice");
    expect(nonTextKind([{ type: "file", mimeType: "audio/ogg", url: "u" }])).toBe("voice");
    expect(nonTextKind(sticker)).toBe("sticker");
    expect(nonTextKind([{ type: "video", url: "u" }])).toBe("video");
    expect(nonTextKind(photo)).toBe("photo");
    expect(nonTextKind([{ type: "share", url: "u" }])).toBeNull();
    expect(nonTextKind([{ type: "story_mention", url: "u" }])).toBeNull();
    expect(nonTextKind([])).toBeNull();
  });
});

describe("голосовое, стикер и фото вне оплаты (Б6)", () => {
  it("три голосовых подряд в разговоре с ботом — один ответ", async () => {
    const { send, sent } = setup(talking());
    for (let i = 0; i < 3; i++) expect((await send(voice)).outcome).toBe("handled");
    expect(sent).toEqual(["Я понимаю только текст. Напишите код товара или нажмите «Каталог»."]);
  });

  it("стикер после голосового в те же 10 минут — отдельного ответа нет", async () => {
    const { send, sent } = setup(talking());
    await send(voice);
    await send(sticker);
    expect(sent).toHaveLength(1);
  });

  it("два одинаковых вебхука одновременно — отвечает один", async () => {
    const { send, sent } = setup(talking());
    await Promise.all([send(voice), send(voice)]);
    expect(sent).toHaveLength(1);
  });

  it("в обычной переписке с продавцом (бот не говорил) голосовое бот не трогает", async () => {
    const { send, sent } = setup({ locale: "ru" });
    expect((await send(voice)).outcome).toBe("question");
    expect(sent).toEqual([]);
  });

  it("консультант ИИ включён — голосовое и фото его, магазин не вмешивается", async () => {
    setEnvForTests({ ANTHROPIC_API_KEY: "test-key" });
    notifySeller.mockClear();
    const { send, sent } = setup(talking(), [
      { bot_id: "bot-1", key: "consultant_enabled", value: "true" },
    ]);
    expect((await send(voice)).outcome).toBe("question");
    expect((await send(photo)).outcome).toBe("question");
    expect(sent).toEqual([]);
    expect(notifySeller).not.toHaveBeenCalled();
  });

  it("фото без ожидающего оплаты заказа — продавцу с картинкой, покупателю одно «передал»", async () => {
    notifySeller.mockClear();
    const { send, sent } = setup(talking());
    expect((await send(photo)).outcome).toBe("handled");
    expect((await send(photo)).outcome).toBe("handled");
    expect(notifySeller).toHaveBeenCalledTimes(2);
    expect(notifySeller.mock.calls[0]![2]).toMatchObject({ photos: ["https://cdn/p.jpg"] });
    expect(String(notifySeller.mock.calls[0]![1])).toContain("прислал(а) фото");
    expect(sent).toEqual(["Передал ваше фото продавцу. Если нужен каталог — напишите «каталог»."]);
  });

  it("фото вне разговора с ботом — продавцу, покупателю тихо", async () => {
    notifySeller.mockClear();
    const { send, sent } = setup({ locale: "ru" });
    expect((await send(photo)).outcome).toBe("handled");
    expect(notifySeller).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
  });
});
