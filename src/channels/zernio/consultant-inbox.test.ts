import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { customerFromRow, type Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { beforeConsultant, consultantIgnoresSticker, PENDING_STORY_MS } from "./consultant-inbox";
import { VOICE_WRITE_TEXT } from "./nontext";

/**
 * Перенос v1 BOVI (handle-message.ts:395-433): публикация, а вопрос о ней —
 * следующим сообщением; стикер — молчим; голосовое — просим текст.
 */
const now = Date.parse("2026-10-07T08:00:00Z");

function setup(consultant: Record<string, unknown> = {}, locale = "kk") {
  const db = fakeDb();
  db.tables.bot_users = [
    {
      bot_id: "b1",
      user_key: "ig:1",
      platform: "instagram",
      telegram_id: -1,
      zernio_conversation_id: "conv-1",
      zernio_account_id: "acc-1",
      // Чужие ключи состояния (бот, v1) не должны пропасть.
      state: { locale, mode: "idle", direct: { forwarded_at: "x" }, consultant },
    },
  ];
  const ctx = {
    tenant: { id: "b1", settings: {}, modules: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const customer = customerFromRow(db.tables.bot_users[0]! as never) as Customer;
  const send = vi.fn(async () => ({ ok: true as const }));
  const transport = { send } as unknown as ZernioTransport;
  const state = () => db.tables.bot_users![0]!.state as Record<string, Record<string, unknown>>;
  return { ctx, customer, send, transport, state };
}

const msg = (p: Partial<ParsedZernioMessage>): ParsedZernioMessage =>
  ({
    platform: "instagram",
    conversationId: "conv-1",
    accountId: "acc-1",
    senderId: "1",
    text: "",
    postbackPayload: null,
    attachments: [],
    storyId: null,
    storyMediaUrl: null,
    storyCaption: null,
    ...p,
  }) as ParsedZernioMessage;

const REEL = "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=reel1";

describe("публикация, а вопрос — следующим сообщением", () => {
  it("рилс без слов запоминается молча, «Сколько стоит?» через минуту получает его", async () => {
    const s = setup();
    const first = await beforeConsultant(
      s.ctx,
      s.customer,
      msg({
        storyId: "reel1",
        storyMediaUrl: REEL,
        storyCaption: "Полотенца Pip Studio",
        attachments: [{ type: "share", url: REEL }] as never,
      }),
      s.transport,
      { customerPhotos: 0, now },
    );
    expect(first).toMatchObject({ done: true, note: "публикация запомнена до вопроса" });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.state().consultant!.pending_story).toEqual({
      id: "reel1",
      url: REEL,
      caption: "Полотенца Pip Studio",
      at: new Date(now).toISOString(),
    });
    expect(s.state().direct).toEqual({ forwarded_at: "x" });

    const second = await beforeConsultant(
      s.ctx,
      first.customer,
      msg({ text: "Сколько стоит?" }),
      s.transport,
      { customerPhotos: 0, now: now + 60_000 },
    );
    // Подпись едет вместе с публикацией: по ней ИИ поймёт, о каком товаре «Сколько стоит?».
    expect(second).toMatchObject({
      done: false,
      story: { storyId: "reel1", mediaUrl: REEL, caption: "Полотенца Pip Studio" },
    });
    // Отдана вопросу — к следующему не прилипает.
    expect(s.state().consultant!.pending_story).toBeUndefined();
    const third = await beforeConsultant(
      s.ctx,
      second.customer,
      msg({ text: "А доставка?" }),
      s.transport,
      { customerPhotos: 0, now: now + 90_000 },
    );
    expect(third).toMatchObject({ done: false, story: { storyId: null, mediaUrl: null } });
  });

  it("вопрос через три минуты и позже — без старой публикации", async () => {
    const s = setup({
      pending_story: {
        id: "reel1",
        url: REEL,
        at: new Date(now - PENDING_STORY_MS - 1).toISOString(),
      },
      recent: [{ role: "customer", text: "привет" }],
    });
    const r = await beforeConsultant(
      s.ctx,
      s.customer,
      msg({ text: "Сколько стоит?" }),
      s.transport,
      {
        customerPhotos: 0,
        now,
      },
    );
    expect(r).toMatchObject({ done: false, story: { storyId: null, mediaUrl: null } });
    expect(s.state().consultant!.pending_story).toBeUndefined();
    expect(s.state().consultant!.recent).toEqual([{ role: "customer", text: "привет" }]);
  });

  it("публикация со словами — сразу консультанту со своей публикацией", async () => {
    const s = setup();
    const r = await beforeConsultant(
      s.ctx,
      s.customer,
      msg({ text: "цена?", storyId: "st2", storyMediaUrl: REEL }),
      s.transport,
      { customerPhotos: 0, now },
    );
    expect(r).toMatchObject({ done: false, story: { storyId: "st2", mediaUrl: REEL } });
    expect(s.state().consultant!.pending_story).toBeUndefined();
  });
});

describe("не текст консультанту", () => {
  it("стикер и гифка из стикеров — молчим; фото и текст — нет", () => {
    expect(
      consultantIgnoresSticker(msg({ attachments: [{ type: "sticker", url: "s" }] as never })),
    ).toBe(true);
    expect(
      consultantIgnoresSticker(
        msg({ attachments: [{ type: "image", url: "https://media.giphy.com/a.gif" }] as never }),
      ),
    ).toBe(true);
    expect(
      consultantIgnoresSticker(
        msg({ attachments: [{ type: "image", url: "https://cdn/x.jpg" }] as never }),
      ),
    ).toBe(false);
    expect(
      consultantIgnoresSticker(
        msg({ text: "ок", attachments: [{ type: "sticker", url: "s" }] as never }),
      ),
    ).toBe(false);
  });

  it("голосовое — просьба писать текстом на языке покупателя, два подряд — одна", async () => {
    const s = setup({}, "uz");
    const voice = msg({ attachments: [{ type: "audio", url: "https://cdn/v.mp4" }] as never });
    const [a, b] = await Promise.all([
      beforeConsultant(s.ctx, s.customer, voice, s.transport, { customerPhotos: 0, now }),
      beforeConsultant(s.ctx, s.customer, voice, s.transport, { customerPhotos: 0, now }),
    ]);
    expect(a.done && b.done).toBe(true);
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send).toHaveBeenCalledWith("conv-1", "acc-1", VOICE_WRITE_TEXT.uz, {
      platform: "instagram",
    });
    expect(s.state().consultant!.voice_asked_at).toBe(new Date(now).toISOString());
    expect(s.state().direct).toEqual({ forwarded_at: "x" });
  });
});
