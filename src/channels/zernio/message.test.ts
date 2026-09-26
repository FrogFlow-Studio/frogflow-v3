import { describe, expect, it } from "vitest";
import { messageAsText, parseZernioMessage } from "./message";

/** Настоящее событие из журнала v1 (12.08.2026) — на нём прежний разбор промахивался. */
const realEvent = {
  id: "f0993c4c-1b7c-4955-80eb-f22034d5a120",
  event: "message.received",
  account: {
    id: "6a698cc9df17280d93c77269",
    platform: "instagram",
    username: "aa_teach_",
    accountId: "6a698cc9df17280d93c77269",
  },
  message: {
    id: "6a7c528b77555aae01003c47",
    text: "Куда вы пришлете материал?",
    isRead: false,
    sender: {
      id: "1564412301739124",
      name: "Анна Венгловская",
      username: "annavenglovskaia",
      contactId: "6a7b1b14e3838f1e952dbc4f",
      instagramProfile: {
        isFollower: true,
        isVerified: false,
        isFollowing: false,
        followerCount: 286,
      },
    },
    sentAt: "2026-08-12T11:01:29.779Z",
    platform: "instagram",
    direction: "incoming" as const,
    attachments: [],
    conversationId: "6a7b1b00d0fe733d1a2ab5b0",
  },
  conversation: {
    id: "6a7b1b00d0fe733d1a2ab5b0",
    participantId: "1564412301739124",
    participantName: "Анна Венгловская",
    participantUsername: "annavenglovskaia",
  },
};

describe("parseZernioMessage", () => {
  it("разбирает настоящее событие целиком", () => {
    const p = parseZernioMessage(realEvent);
    expect(p.conversationId).toBe("6a7b1b00d0fe733d1a2ab5b0");
    expect(p.accountId).toBe("6a698cc9df17280d93c77269");
    expect(p.platform).toBe("instagram");
    expect(p.senderId).toBe("1564412301739124");
    expect(p.senderUsername).toBe("annavenglovskaia");
    expect(p.senderName).toBe("Анна Венгловская");
    expect(p.text).toBe("Куда вы пришлете материал?");
    expect(p.outgoing).toBe(false);
  });

  it("забирает профиль подписчика из message.sender — то, что v1 терял", () => {
    expect(parseZernioMessage(realEvent).metadata).toMatchObject({
      isFollower: true,
      followerCount: 286,
      zernioContactId: "6a7b1b14e3838f1e952dbc4f",
    });
  });

  it("не выдумывает профиль и id, когда их нет", () => {
    const p = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: { id: "u1" } },
      account: { _id: "a1" },
    });
    expect(p.metadata).toEqual({});
    expect(p.accountId).toBe("a1");
    expect(p.senderName).toBe("друг");
  });

  it("text=null у сообщения с одним вложением — пустая строка, вложение видно", () => {
    const p = parseZernioMessage({
      event: "message.received",
      message: {
        conversationId: "c1",
        text: null,
        sender: { id: "u1" },
        attachments: [{ type: "image", url: "https://cdn/x.jpg" }],
      },
      account: { accountId: "a1" },
    });
    expect(p.text).toBe("");
    expect(p.attachments).toEqual([{ type: "image", url: "https://cdn/x.jpg" }]);
    expect(messageAsText(p)).toBe("[вложение: image]");
  });

  it("чек вложением: ссылка из payload.url (Instagram), из медиа WhatsApp, mime сохраняется", () => {
    const p = parseZernioMessage({
      event: "message.received",
      message: {
        conversationId: "c1",
        sender: { id: "u1" },
        attachments: [
          { type: "image", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?a=1" } },
          {
            type: "document",
            document: { url: "https://zernio.com/api/v1/media/m1" },
            mimeType: "application/pdf",
          },
          { type: "image", mediaUrl: "https://zernio.com/api/v1/media/m2" },
        ],
      },
      account: { accountId: "a1" },
    });
    expect(p.attachments).toEqual([
      { type: "image", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?a=1" },
      { type: "document", url: "https://zernio.com/api/v1/media/m1", mimeType: "application/pdf" },
      { type: "image", url: "https://zernio.com/api/v1/media/m2" },
    ]);
    expect(p.mediaWithoutUrl).toBe(false);
  });

  it("вложение без ссылки или не с http(s) — отмечено, а не пропало молча", () => {
    const p = parseZernioMessage({
      event: "message.received",
      message: {
        conversationId: "c1",
        sender: { id: "u1" },
        attachments: [
          { type: "image", id: "wamid.1" },
          { type: "image", url: "javascript:alert(1)" },
        ],
      },
      account: { accountId: "a1" },
    });
    expect(p.attachments).toEqual([]);
    expect(p.mediaWithoutUrl).toBe(true);
    expect(messageAsText(p)).toBe("[вложение без ссылки]");
  });

  it("нажатие читается из корня события: Instagram postback и строка списка WhatsApp", () => {
    const ig = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: { id: "u1" } },
      account: { accountId: "a1" },
      metadata: { postbackPayload: "CHECKOUT" },
    });
    expect(ig.postbackPayload).toBe("CHECKOUT");
    const wa = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: { id: "77011234567" } },
      account: { accountId: "a1", platform: "whatsapp" },
      metadata: { interactiveType: "list_reply", interactiveId: "CAT:abc" },
    });
    expect(wa.platform).toBe("whatsapp");
    expect(wa.postbackPayload).toBe("CAT:abc");
    expect(wa.senderPhone).toBe("77011234567");
    expect(messageAsText(wa)).toBe("CAT:abc");
  });

  it("обычное сообщение — не нажатие; чужая платформа падает в instagram", () => {
    const p = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", text: "привет", sender: { id: "u1" }, platform: "tiktok" },
      account: { accountId: "a1", platform: "facebook" },
      metadata: { interactiveType: "text" },
    });
    expect(p.postbackPayload).toBeNull();
    expect(p.platform).toBe("instagram");
  });

  it("корзина из каталога WhatsApp превращается в текст для журнала", () => {
    const p = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: { id: "u1", phoneNumber: "+77011234567" } },
      account: { accountId: "a1", platform: "whatsapp" },
      metadata: {
        order: {
          catalog_id: "cat",
          text: "без сахара",
          product_items: [
            { product_retailer_id: "sku1", quantity: 2, item_price: 1500, currency: "KZT" },
          ],
        },
      },
    });
    expect(p.nativeOrder?.items[0]).toEqual({
      retailerId: "sku1",
      quantity: 2,
      price: 1500,
      currency: "KZT",
    });
    expect(p.senderPhone).toBe("+77011234567");
    expect(messageAsText(p)).toBe("Корзина из каталога WhatsApp: sku1 × 2. без сахара");
  });

  it("ответ на сторис: id из метаданных события, ссылка — из вложения", () => {
    const m = parseZernioMessage({
      ...realEvent,
      metadata: { storyReply: { storyId: "17900000000000001" } },
      message: {
        ...realEvent.message,
        text: "сколько стоит?",
        attachments: [{ type: "story", url: "https://cdn.example/story123.jpg" }],
      },
    } as never);
    expect(m.storyId).toBe("17900000000000001");
    expect(m.storyMediaUrl).toBe("https://cdn.example/story123.jpg");
    expect(parseZernioMessage(realEvent).storyId).toBeNull();
  });

  it("исходящее сообщение помечается, чтобы не отвечать самим себе", () => {
    expect(
      parseZernioMessage({
        event: "message.received",
        message: { conversationId: "c1", text: "наш ответ", direction: "outgoing" },
        account: { accountId: "a1" },
      }).outgoing,
    ).toBe(true);
  });
});
