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
    expect(p.attachments).toEqual([{ type: "image", url: "https://cdn/x.jpg", index: 0 }]);
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
      { type: "image", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?a=1", index: 0 },
      {
        type: "document",
        url: "https://zernio.com/api/v1/media/m1",
        mimeType: "application/pdf",
        index: 1,
      },
      { type: "image", url: "https://zernio.com/api/v1/media/m2", index: 2 },
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

  it("кнопка шаблона WhatsApp: payload из metadata.buttonPayload — нажатие", () => {
    const wa = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", text: "Купить", sender: { id: "77011234567" } },
      account: { accountId: "a1", platform: "whatsapp" },
      metadata: { buttonPayload: "PROD:p-1" },
    });
    expect(wa.postbackPayload).toBe("PROD:p-1");
    expect(wa.text).toBe("Купить");
  });

  it("кнопка шаблона без своего payload (Meta кладёт туда текст) — обычный текст", () => {
    const wa = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", text: "Отписаться", sender: { id: "77011234567" } },
      account: { accountId: "a1", platform: "whatsapp" },
      metadata: { buttonPayload: "Отписаться" },
    });
    expect(wa.postbackPayload).toBeNull();
    expect(wa.text).toBe("Отписаться");
    const noText = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", text: null, sender: { id: "77011234567" } },
      account: { accountId: "a1", platform: "whatsapp" },
      metadata: { buttonPayload: "Отписаться" },
    });
    expect(noText.postbackPayload).toBeNull();
    expect(noText.text).toBe("Отписаться");
    const ours = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: { id: "77011234567" } },
      account: { accountId: "a1", platform: "whatsapp" },
      metadata: { buttonPayload: "CATALOG" },
    });
    expect(ours.postbackPayload).toBe("CATALOG");
    expect(ours.text).toBe("");
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

describe("parseZernioMessage — аккаунт и нажатия (опись v1)", () => {
  const base = {
    event: "message.received",
    message: { conversationId: "c1", sender: { id: "u1" } },
  };
  /** Строка списка WhatsApp: подпись строки дублируется в message.text. */
  const waListReply = {
    event: "message.received",
    account: { id: "wa-acc", accountId: "wa-acc", platform: "whatsapp" },
    message: {
      conversationId: "c1",
      text: "⛺ ЛАГЕРЬ И ВНЕУРОЧКА",
      sender: { id: "77011234567" },
    },
    metadata: {
      interactiveType: "list_reply",
      interactiveId: "CAT:e37096e4-195b-4fde-9a41-effff658fe01:0",
    },
  };

  it("берёт accountId как канонический, а не id", () => {
    const { accountId } = parseZernioMessage({
      ...base,
      account: { id: "запасной", accountId: "канонический" },
    });
    expect(accountId).toBe("канонический");
  });

  it("подпись строки приходит текстом и остаётся в text, не подменяя payload", () => {
    const parsed = parseZernioMessage(waListReply);
    expect(parsed.text).toBe("⛺ ЛАГЕРЬ И ВНЕУРОЧКА");
    expect(parsed.postbackPayload).toBe("CAT:e37096e4-195b-4fde-9a41-effff658fe01:0");
  });

  it("кнопка чужой автоматизации Zernio отдаётся как есть", () => {
    const parsed = parseZernioMessage({
      ...base,
      account: { accountId: "ig-acc", platform: "instagram" },
      message: { ...base.message, text: "Я подписался (ась)" },
      metadata: {
        postbackPayload: "ACT::cc82e5ebd3b465e3243fde66982ba8d0",
        postbackTitle: "Я подписался (ась)",
      },
    });
    expect(parsed.postbackPayload).toBe("ACT::cc82e5ebd3b465e3243fde66982ba8d0");
    expect(parsed.text).toBe("Я подписался (ась)");
  });

  it("кнопка WhatsApp (button_reply) читается так же, как строка списка", () => {
    const parsed = parseZernioMessage({
      ...waListReply,
      message: { ...waListReply.message, text: "В корзину" },
      metadata: { interactiveType: "button_reply", interactiveId: "BUY:42" },
    });
    expect(parsed.postbackPayload).toBe("BUY:42");
  });

  it("служебный id 0 не перехватывает текст кнопки WhatsApp", () => {
    const parsed = parseZernioMessage({
      ...waListReply,
      message: { ...waListReply.message, text: "Оплата картой" },
      metadata: { interactiveType: "button_reply", interactiveId: "0" },
    });
    expect(parsed.text).toBe("Оплата картой");
    expect(parsed.postbackPayload).toBeNull();
    expect(parsed.metadata.zernioOpaqueButtonTap).toBe(true);
  });

  it("запасное чтение из message.metadata работает, если форма вернётся", () => {
    const { metadata, ...withoutTopLevel } = waListReply;
    const parsed = parseZernioMessage({
      ...withoutTopLevel,
      message: { ...waListReply.message, metadata },
    } as never);
    expect(parsed.postbackPayload).toBe("CAT:e37096e4-195b-4fde-9a41-effff658fe01:0");
  });
});
