/**
 * Золотые диалоги (Б14): сценарии «покупатель пишет → бот отвечает» на настоящем
 * коде каналов и базе в памяти. Здесь — две «комнаты» с одним интерфейсом:
 * Telegram и Direct (Instagram/WhatsApp). Сценарии (scenarios.ts) не знают, какой
 * канал под ними, кроме поля `channel`.
 *
 * Правило (CLAUDE.md): каждая найденная поломка диалога сначала становится
 * сценарием в tests/dialogs/scenarios.ts, потом чинится.
 */
import { vi } from "vitest";
import { fakeDb, type FakeDb } from "../fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { userKey } from "@/core/customers/customers";
import type { Locale } from "@/core/i18n/locale";
import type { ParsedZernioMessage } from "@/channels/zernio/message";
import type { ZernioTransport } from "@/channels/zernio/api.server";
import type { TelegramApi } from "@/channels/telegram/api";
import { handleShopMessage } from "@/channels/zernio/shop.server";
import { handleTelegramUpdate } from "@/channels/telegram/handle-update";
import { claimTelegramUpdate } from "@/channels/telegram/dedupe";
import { handleZernioMessage } from "@/channels/zernio/handle-message";
import { orderTrackRefLine } from "@/channels/telegram/order-notify-keys";
import { pollTenantInbox } from "@/channels/zernio/inbox-poll.server";
import { dispatchZernioEvent } from "@/channels/zernio/dispatch.server";
import type { ZernioInboxMessage } from "@/channels/zernio/inbox-types";

export type Channel = "telegram" | "instagram" | "whatsapp";

/** Что покупатель делает в диалоге. */
export type Input =
  | { text: string }
  /** Нажатие кнопки: `button` — payload, `title` — подпись (Instagram присылает её текстом). */
  | { button: string; title?: string }
  | { voice: true }
  | { sticker: true }
  | { photo: true }
  /** Фото с подписью одним сообщением (kopats23: скриншот ошибки и «Не проходит»). */
  | { photoWithText: string }
  /** Та же реплика ещё раз: двойная доставка вебхука или двойной клик. */
  | { repeat: true }
  /**
   * Несколько сообщений подряд, пока бот думает: вебхуки приходят и
   * обрабатываются одновременно («Здравствуйте» / «Есть полотенца?» / «А белые?»).
   */
  | { burst: string[] }
  /**
   * Instagram/WhatsApp (только `full`): пачка фото одним касанием — вебхук на
   * каждое фото с разницей в доли секунды, подпись (если есть) — следом.
   * `gapMs` — разрыв между вебхуками (по умолчанию 20 мс): Zernio шлёт фото
   * одной пачки и с разницей в секунды (BOVI 11.10, 4–12 с).
   */
  | { photos: number; caption?: string; gapMs?: number }
  /**
   * Instagram/WhatsApp (только `full`): одна кнопка нажата `clicks` раз подряд —
   * вебхуки обрабатываются одновременно (zuxra6163, 8 нажатий «Купить», AATeach 11.10).
   */
  | { clicks: number; button: string; title?: string }
  /** Вложение, к которому Zernio не прислал ссылку (пересланная публикация, фото без адреса). */
  | { attachmentNoUrl: true }
  /** Сообщение, написанное `minutes` минут назад: канал доставил его с опозданием. */
  | { late: string; minutes: number }
  /**
   * Instagram/WhatsApp (только `full`): прошлый ход консультанта завис и держит
   * аренду диалога дольше, чем ждёт новое сообщение (core/consultant/burst).
   */
  | { stuck: string }
  /** Продавец из Telegram отвечает номером на «Отправлен + трек» по заказу №… (Б12). */
  | { sellerTrack: string; orderId: number }
  /**
   * Instagram/WhatsApp (только `full`): покупатель написал, вебхук Zernio не
   * пришёл. Через две минуты крон опроса ящика (inbox-poll) находит сообщение.
   */
  | { missed: string }
  /**
   * Как `missed`, но список сообщений Zernio отдаёт id в виде Mongo `_id`, а
   * вебхук — своим `id`: совпадает только id сообщения у Meta
   * (platformMessageId). Так в живых данных или нет — не подтверждено.
   */
  | { missed: string; mongoIds: true }
  /** Поздний вебхук о последнем `missed` — то же сообщение Zernio, своё событие. */
  | { lateWebhook: true }
  /**
   * Instagram/WhatsApp (только `full`): продавец ответил прямо в приложении,
   * события об исходящем Zernio не прислал; через минуту крон опроса ящика.
   */
  | { appReply: string }
  /**
   * Instagram/WhatsApp (только `full`): продавец ответил покупателю руками в
   * приложении — Zernio присылает исходящее сообщение (sentVia: null — человек).
   */
  | { sellerWrites: string };

export interface Product {
  id: string;
  name: string;
  price?: number;
  /** Ключевые слова карточки («кпп, план»). */
  keywords?: string;
  /** Описание карточки. */
  description?: string;
}

/** Что видно после реплики: ответы бота, кнопки, корзина, состояние. */
export interface Room {
  say(input: Input): Promise<void>;
  /** Ответы бота на последнюю реплику (тексты без разметки). */
  replies(): string[];
  /** Заголовки кнопок последнего ответа. */
  buttons(): string[];
  /** id товаров в корзине. */
  cart(): string[];
  /** Состояние покупателя (bot_users.state). */
  state(): Record<string, unknown>;
  /** Сколько раз за весь диалог продавцу ушло уведомление. */
  sellerNotices(): number;
  /**
   * В ленте Zernio исходящее N минут назад без пометки сценария (только Direct):
   * по умолчанию — реплика продавца руками, `text` — другой текст (например,
   * первое сообщение правила «комментарий → Директ»).
   */
  sellerTyped(minutesAgo: number, text?: string): void;
  /** Что за последнюю реплику увидел продавец в Telegram (ответы бота ему). */
  sellerReplies(): string[];
  /** Причины ответов бота, записанные в «Чат» («Почему бот так ответил», Б13). */
  reasons(): string[];
  /** Сколько уведомлений продавцу поставлено в очередь (outbox, admin_notice) за весь диалог. */
  sellerQueued(): number;
  db: FakeDb;
}

export interface RoomOptions {
  channel: Channel;
  locale: Locale;
  products?: Product[];
  /** Начальное состояние покупателя (шаг, страна, …). */
  state?: Record<string, unknown>;
  modules?: Record<string, boolean>;
  /** Ниша клиента; по умолчанию digital (магазин). */
  vertical?: string;
  /**
   * Instagram/WhatsApp: реплика идёт через весь разбор входящего (handleZernioMessage),
   * а не только через магазин: так работают слова «позови человека» и пауза.
   */
  full?: boolean;
  /** Instagram/WhatsApp: отправка покупателю не прошла (обрыв, тайм-аут) — дошло ли, неизвестно. */
  sendFails?: boolean;
  /** Instagram/WhatsApp: канал отклоняет любые кнопки (400), текст без кнопок проходит. */
  rejectButtons?: boolean;
  /** Добавка к bots.settings клиента (например, консультант по прайсу). */
  tenantSettings?: Record<string, unknown>;
  /** Instagram/WhatsApp: ник покупателя во входящем (без него правила комментариев не срабатывают). */
  username?: string;
  /** Instagram/WhatsApp: почта платформы настроена, письма — в mailbox. */
  mail?: boolean;
  /** Instagram/WhatsApp: присланное фото скачивается (чек принимается). */
  receipts?: boolean;
  /**
   * Instagram/WhatsApp: ответы бота появляются в ленте Zernio (tail) как исходящие,
   * как в жизни, — проверка «менеджер в чате» видит их и должна узнать свои.
   */
  echoes?: boolean;
}

/** Куда уходят сообщения покупателю, отправленные не из его реплики (ответ продавца, трек). */
export const outbound: { sink: ((html: string) => void) | null } = { sink: null };
export const SELLER_ID = 900;

export const ROOM_BOT = "00000000-0000-4000-8000-0000000000aa";
const BOT = ROOM_BOT;
export const notices = { count: 0 };
/** Письма покупателю (адреса по порядку) — почта платформы в комнате с `mail`. */
export const mailbox: { to: string[] } = { to: [] };

/**
 * Модель «думает», пока все сообщения пачки не встали в очередь диалога: в
 * жизни ответ модели — секунды, а соседние вебхуки — миллисекунды. Раньше
 * это было 15 мс сна, и под нагрузкой прогона третий вебхук не успевал —
 * сценарий пачки падал через раз (09.10, gate #64 и #65).
 */
export const modelHold: { wait: Promise<void> | null } = { wait: null };

/**
 * Что видела модель консультанта: на каждый вызов — число картинок и текст
 * последнего сообщения покупателя (с пометками). Заполняет подмена SDK в
 * dialogs.test.ts.
 */
export const modelSeen: { calls: Array<{ images: number; text: string }> } = { calls: [] };

/** Самый маленький JPEG для подменённой загрузки фото покупателя. */
const TINY_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function holdModelUntilQueued(rows: () => Array<{ state?: unknown }>, n: number): () => void {
  let done = false;
  modelHold.wait = (async () => {
    const until = Date.now() + 2_000;
    while (!done && Date.now() < until) {
      const queued = rows().reduce((max, r) => {
        const inbox = (r.state as { consultant?: { inbox?: unknown[] } } | undefined)?.consultant
          ?.inbox;
        return Math.max(max, Array.isArray(inbox) ? inbox.length : 0);
      }, 0);
      if (queued >= n) return;
      await new Promise((r) => setTimeout(r, 1));
    }
  })();
  return () => {
    done = true;
    modelHold.wait = null;
  };
}

const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

const productRow = (p: Product, i: number) => ({
  id: p.id,
  bot_id: BOT,
  name: p.name,
  keywords: p.keywords ?? null,
  description: p.description ?? "",
  price: p.price ?? 1000,
  currency: "KZT",
  country_prices: {},
  is_active: true,
  sort_order: i + 1,
  fulfillment_kind: "digital",
  stock_quantity: null,
  category_ids: "[]",
  rating_count: 0,
  rating_avg: 0,
  created_at: "2026-01-01T00:00:00Z",
  file_path: `${BOT}/${p.id}.pdf`,
  product_images: [],
  product_variants: [],
  product_material_files: [],
});

function baseDb(o: RoomOptions, key: string, platform: string, telegramId: number) {
  const db = fakeDb({
    unique: { zernio_logs: [["event_id"]] },
    rpc: { manager_chat_touch: () => {} },
  });
  // Блокировка оформления: свободно (настоящая — условная запись в базе).
  const rpc = db.rpc;
  db.rpc = async (name, args) =>
    name === "claim_order_placement" ? { data: true, error: null } : rpc(name, args);
  db.tables.bot_users = [
    {
      id: "u1",
      bot_id: BOT,
      user_key: key,
      platform,
      telegram_id: telegramId,
      opt_out: false,
      loyalty_points: 0,
      zernio_conversation_id: platform === "telegram" ? null : "conv-1",
      zernio_account_id: platform === "telegram" ? null : "acc-1",
      state: { locale: o.locale, country_code: "KZ", ...(o.state ?? {}) },
    },
  ];
  db.tables.manager_chat_state = [];
  db.tables.manager_chat_messages = [];
  db.tables.manager_chat_reasons = [];
  db.tables.zernio_logs = [];
  db.tables.products = (o.products ?? []).map(productRow);
  db.tables.product_variants = [];
  db.tables.categories = [];
  db.tables.cart_items = [];
  db.tables.orders = [];
  db.tables.app_settings = [];
  db.tables.payment_methods = [
    {
      id: "pm1",
      bot_id: BOT,
      is_active: true,
      sort_order: 1,
      country_code: "KZ",
      country_name: "Казахстан",
      currency: "KZT",
    },
  ];
  const ctx = {
    tenant: {
      id: BOT,
      name: "Тест-магазин",
      status: "active",
      vertical: o.vertical ?? "digital",
      modules: {
        ...(o.full ? { instagram: true, whatsapp: true, dm_shop: true, wa_shop: true } : {}),
        ...(o.modules ?? {}),
      },
      settings: { default_locale: o.locale, ...(o.tenantSettings ?? {}) },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { db, ctx };
}

/** Ответ продавца из Telegram на «Отправлен + трек»: настоящий путь handleTelegramUpdate. */
async function sellerTrackReply(
  ctx: TenantContext,
  orderId: number,
  text: string,
): Promise<{ buyer: string[]; seller: string[] }> {
  const buyer: string[] = [];
  const seller: string[] = [];
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      if (method === "sendMessage") {
        const line = plain(String(payload.text ?? ""));
        if (Number(payload.chat_id) === SELLER_ID) seller.push(line);
        else buyer.push(line);
      }
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  const from = { id: SELLER_ID, is_bot: false, first_name: "Продавец" };
  await handleTelegramUpdate(ctx, api, {
    update_id: 9000 + orderId,
    message: {
      message_id: 9,
      chat: { id: SELLER_ID, type: "private" },
      from,
      text,
      reply_to_message: { message_id: 8, text: `📦 Заказ\n${orderTrackRefLine(orderId)}` },
    },
  } as never);
  return { buyer, seller };
}

const queuedOf = (db: FakeDb) =>
  (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "outbox.admin_notice").length;

const reasonsOf = (db: FakeDb) =>
  (db.tables.manager_chat_reasons ?? []).map((r) => String(r.reason ?? ""));

function directRoom(o: RoomOptions): Room {
  const platform = o.channel as "instagram" | "whatsapp";
  let eventNo = 0;
  const key = platform === "whatsapp" ? "wa_1" : "ig_1";
  const { db, ctx } = baseDb(o, key, platform, -1);
  const sent: Array<{ text: string; buttons: string[] }> = [];
  let sellerLines: string[] = [];
  let mark = 0;
  let tail: unknown[] = [];
  /** Ящик Zernio: сообщения, о которых вебхук не сообщил (`missed`). */
  const inbox: ZernioInboxMessage[] = [];
  let last: Input | null = null;
  const transport = {
    send: vi.fn(
      async (
        _c: string,
        _a: string,
        text: string,
        opts: { buttons?: Array<{ title?: string }> } = {},
      ) => {
        // Обрыв: покупатель (насколько известно) ничего не получил.
        if (o.sendFails) return { ok: false, error: "timeout" };
        // Meta: с кнопками текст не длиннее 640 знаков, иначе отказ и ничего не уходит
        // (заказ #10 Дидактики 07.10, заказ #15 Копилки 09.10).
        if (opts.buttons?.length && (o.rejectButtons || text.length > 640))
          return { ok: false, error: "buttons rejected", failure: { status: 400 } };
        sent.push({ text: plain(text), buttons: (opts.buttons ?? []).map((b) => b.title ?? "") });
        if (o.echoes && text)
          tail.push({ direction: "outgoing", message: text, createdAt: new Date().toISOString() });
        return { ok: true };
      },
    ),
    tail: vi.fn(async () => [...tail, ...inbox]),
    // Фото чека скачивается (receipts) — иначе вложение не читается.
    download: vi.fn(async () =>
      o.receipts
        ? { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mime: "image/jpeg" }
        : null,
    ),
    mailReady: () => Boolean(o.mail),
    mailer: async (m: { to: string }) => {
      mailbox.to.push(m.to);
      return { ok: true };
    },
  } as unknown as ZernioTransport;
  let current = {
    userKey: key,
    platform,
    telegramId: -1,
    username: null,
    firstName: "Анна",
    lastName: null,
    languageCode: null,
    contactPhone: null,
    email: null,
    loyaltyPoints: 0,
    state: db.tables.bot_users![0]!.state,
    zernioConversationId: "conv-1",
    zernioAccountId: "acc-1",
  } as unknown as Customer;
  const parsed = (m: Partial<ParsedZernioMessage>): ParsedZernioMessage =>
    ({
      conversationId: "conv-1",
      accountId: "acc-1",
      platform,
      senderId: "1",
      senderUsername: "",
      senderName: "Анна",
      senderPhone: "",
      text: "",
      metadata: {},
      postbackPayload: null,
      nativeOrder: null,
      platformMessageId: null,
      attachments: [],
      mediaWithoutUrl: false,
      storyId: null,
      storyMediaUrl: null,
      storyCaption: null,
      outgoing: false,
      ...m,
    }) as ParsedZernioMessage;
  const toMessage = (i: Input): Partial<ParsedZernioMessage> => {
    if ("text" in i) return { text: i.text };
    if ("late" in i)
      return { text: i.late, sentAt: new Date(Date.now() - i.minutes * 60_000).toISOString() };
    if ("burst" in i || "photos" in i || "clicks" in i) return {};
    if ("photoWithText" in i)
      return {
        text: i.photoWithText,
        attachments: [{ type: "image", url: "https://cdn.test/image", index: 0 }] as never,
      };
    if ("attachmentNoUrl" in i) return { attachments: [{ type: "share" }] as never };
    if ("stuck" in i) return { text: i.stuck };
    if ("button" in i) return { text: i.title ?? i.button, postbackPayload: i.button };
    if ("sellerTrack" in i) return {};
    const kind = "voice" in i ? "audio" : "sticker" in i ? "sticker" : "image";
    return { attachments: [{ type: kind, url: `https://cdn.test/${kind}`, index: 0 }] as never };
  };
  const webhook = (m: Partial<ParsedZernioMessage>) => ({
    id: `evt-${++eventNo}`,
    event: "message.received",
    account: { id: "acc-1", platform },
    message: {
      id: `m-${eventNo}`,
      conversationId: "conv-1",
      platform,
      direction: "incoming",
      text: m.text ?? "",
      attachments: (m.attachments ?? []).map((a) => ({ type: a.type, url: a.url })),
      sender: { id: "1", name: "Анна", ...(o.username ? { username: o.username } : {}) },
      ...(m.sentAt ? { sentAt: m.sentAt } : {}),
      ...(m.postbackPayload ? { metadata: { postbackPayload: m.postbackPayload } } : {}),
    },
  });
  return {
    db,
    async say(i) {
      mark = sent.length;
      sellerLines = [];
      if ("repeat" in i) i = last ?? { text: "" };
      else last = i;
      if ("sellerTrack" in i) {
        const prev = outbound.sink;
        outbound.sink = (html) => sent.push({ text: plain(html), buttons: [] });
        try {
          sellerLines = (await sellerTrackReply(ctx, i.orderId, i.sellerTrack)).seller;
        } finally {
          outbound.sink = prev;
        }
        return;
      }
      if ("missed" in i || "lateWebhook" in i || "appReply" in i) {
        if (!o.full)
          throw new Error("missed/lateWebhook/appReply — только в полном разборе (full)");
        const poll = async (updatedTime: string | undefined) => {
          // Опрос видит только клиента v2 с подключённым аккаунтом.
          const t = ctx.tenant;
          t.settings = {
            ...t.settings,
            served_by: "v2",
            zernio: { account_ids: ["acc-1"], accounts: [{ id: "acc-1", platform }] },
          };
          await pollTenantInbox(ctx, {
            listConversations: async () => [{ id: "conv-1", participantId: "1", updatedTime }],
            transport,
            dispatch: dispatchZernioEvent,
            consultantEnabled: async (c) =>
              (await import("@/core/consultant/engine.server")).consultantEnabled(c),
            page: 50,
          });
        };
        if ("appReply" in i) {
          // Ответ менеджера — через секунду после предыдущих шагов: задача консультанта,
          // заведённая в ту же миллисекунду (быстрый раннер, TEST_NOW шагом 20 мс), иначе
          // считается более поздней, чем ответ, и опрос её честно не закрывает.
          const at = new Date(Date.now() + 1000).toISOString();
          inbox.push({ direction: "outgoing", message: i.appReply, sentVia: null, createdAt: at });
          await poll(at);
        } else if ("missed" in i) {
          const n = inbox.length + 1;
          inbox.push({
            ...("mongoIds" in i
              ? { _id: `zid-missed-${n}`, platformMessageId: `mid-missed-${n}` }
              : { id: `m-missed-${n}` }),
            direction: "incoming",
            message: i.missed,
            createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
            sender: { id: "1", name: "Анна" },
          });
          await poll(inbox.at(-1)!.createdAt);
        } else {
          const msg = inbox.at(-1);
          if (!msg) throw new Error("lateWebhook без missed");
          const late = webhook({ text: msg.message ?? "" });
          if (msg._id) {
            late.message.id = `wh-${msg._id}`;
            Object.assign(late.message, { platformMessageId: msg.platformMessageId });
          } else late.message.id = msg.id!;
          await dispatchZernioEvent(ctx, late.id, late as never, transport);
        }
        current.state = db.tables.bot_users![0]!.state as Customer["state"];
        return;
      }
      if ("sellerWrites" in i) {
        if (!o.full) throw new Error("sellerWrites — только в полном разборе (full)");
        const out = webhook({ text: i.sellerWrites });
        out.event = "message.sent";
        Object.assign(out.message, { direction: "outgoing", sentVia: null });
        await handleZernioMessage(ctx, out as never, transport);
        current.state = db.tables.bot_users![0]!.state as Customer["state"];
        return;
      }
      if (o.full && "clicks" in i) {
        const hooks = Array.from({ length: i.clicks }, () =>
          webhook({ text: i.title ?? i.button, postbackPayload: i.button }),
        );
        await Promise.all(hooks.map((h) => handleZernioMessage(ctx, h as never, transport)));
        current.state = db.tables.bot_users![0]!.state as Customer["state"];
        return;
      }
      if (o.full && "burst" in i) {
        // Каждая реплика — свой вебхук; обрабатываются одновременно, как на Vercel.
        const hooks = i.burst.map((text) => webhook({ text }));
        const release = holdModelUntilQueued(() => db.tables.bot_users ?? [], hooks.length);
        try {
          await Promise.all(hooks.map((h) => handleZernioMessage(ctx, h as never, transport)));
        } finally {
          release();
        }
        current.state = db.tables.bot_users![0]!.state as Customer["state"];
        return;
      }
      if (o.full && "photos" in i) {
        const hooks = Array.from({ length: i.photos }, (_, k) =>
          webhook({
            attachments: [{ type: "image", url: `https://cdn.test/photo-${k + 1}.jpg` }] as never,
          }),
        );
        if (i.caption) hooks.push(webhook({ text: i.caption }));
        // Фото скачиваются по ссылке — отдаём крошечный JPEG, остальная сеть как была.
        const realFetch = globalThis.fetch;
        const spy = vi
          .spyOn(globalThis, "fetch")
          .mockImplementation(async (input, init) =>
            String(input).startsWith("https://cdn.test/")
              ? new Response(TINY_JPEG, { headers: { "content-type": "image/jpeg" } })
              : realFetch(input, init),
          );
        try {
          await Promise.all(
            hooks.map(async (h, k) => {
              await new Promise((r) => setTimeout(r, k * (i.gapMs ?? 20)));
              await handleZernioMessage(ctx, h as never, transport);
            }),
          );
        } finally {
          spy.mockRestore();
        }
        current.state = db.tables.bot_users![0]!.state as Customer["state"];
        return;
      }
      if (o.full && "stuck" in i) {
        const row = db.tables.bot_users![0]!;
        const st = (row.state ?? {}) as Record<string, unknown>;
        const c = (st.consultant ?? {}) as Record<string, unknown>;
        row.state = {
          ...st,
          consultant: {
            ...c,
            turn: { id: "hung", until: new Date(Date.now() + 10 * 60_000).toISOString() },
          },
        };
        const { BURST } = await import("@/core/consultant/burst");
        const wait = BURST.waitMs;
        BURST.waitMs = 30;
        try {
          await handleZernioMessage(ctx, webhook(toMessage(i)) as never, transport);
        } finally {
          BURST.waitMs = wait;
        }
        current.state = db.tables.bot_users![0]!.state as Customer["state"];
        return;
      }
      if (o.full) {
        await handleZernioMessage(ctx, webhook(toMessage(i)) as never, transport);
        current.state = db.tables.bot_users![0]!.state as Customer["state"];
        return;
      }
      const r = await handleShopMessage(ctx, current, parsed(toMessage(i)), transport);
      current = r.customer;
      current.state = db.tables.bot_users![0]!.state as Customer["state"];
    },
    sellerReplies: () => sellerLines,
    reasons: () => reasonsOf(db),
    sellerQueued: () => queuedOf(db),
    replies: () => sent.slice(mark).map((s) => s.text),
    buttons: () => sent.slice(mark).flatMap((s) => s.buttons),
    cart: () => (db.tables.cart_items ?? []).map((c) => String(c.product_id)),
    state: () => db.tables.bot_users![0]!.state as Record<string, unknown>,
    sellerNotices: () => notices.count,
    sellerTyped(min, text) {
      tail = [
        {
          direction: "outgoing",
          message: text ?? "Здравствуйте! Сейчас отвечу",
          sentVia: null,
          createdAt: new Date(Date.now() - min * 60_000).toISOString(),
        },
      ];
    },
  };
}

function telegramRoom(o: RoomOptions): Room {
  const TG = 42;
  const { db, ctx } = baseDb(o, userKey("telegram", TG), "telegram", TG);
  const calls: Array<[string, Record<string, unknown>]> = [];
  let mark = 0;
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  let updateId = 0;
  let lastUpdate: Record<string, unknown> | null = null;
  // Кнопки под сообщением и кнопки нижнего меню (reply keyboard).
  const buttonsOf = (p: Record<string, unknown>) => {
    const markup = p.reply_markup as
      | {
          inline_keyboard?: Array<Array<{ text: string }>>;
          keyboard?: Array<Array<{ text: string }>>;
        }
      | undefined;
    return [...(markup?.inline_keyboard ?? []), ...(markup?.keyboard ?? [])]
      .flat()
      .map((b) => b.text);
  };
  const messages = () => calls.slice(mark).filter(([m]) => m === "sendMessage");
  let sellerLines: string[] = [];
  return {
    db,
    sellerReplies: () => sellerLines,
    reasons: () => reasonsOf(db),
    sellerQueued: () => queuedOf(db),
    async say(i) {
      mark = calls.length;
      sellerLines = [];
      if ("sellerTrack" in i) {
        const r = await sellerTrackReply(ctx, i.orderId, i.sellerTrack);
        sellerLines = r.seller;
        for (const text of r.buyer) calls.push(["sendMessage", { chat_id: TG, text }]);
        return;
      }
      if ("sellerWrites" in i || "missed" in i || "lateWebhook" in i || "appReply" in i)
        throw new Error("в Telegram такой реплики нет — только в Instagram/WhatsApp");
      const from = { id: TG, is_bot: false, first_name: "Анна" };
      if ("burst" in i) {
        // Несколько сообщений подряд — апдейты обрабатываются одновременно.
        const updates = i.burst.map((text) => {
          updateId++;
          const chat = { id: TG, type: "private" };
          const date = Math.floor(Date.now() / 1000);
          return {
            update_id: updateId,
            message: { message_id: updateId, date, chat, from, text },
          };
        });
        const release = holdModelUntilQueued(() => db.tables.bot_users ?? [], updates.length);
        try {
          await Promise.all(
            updates.map(async (u) => {
              if (await claimTelegramUpdate(ctx, u.update_id))
                await handleTelegramUpdate(ctx, api, u as never);
            }),
          );
        } finally {
          release();
        }
        return;
      }
      const again = "repeat" in i && lastUpdate !== null;
      if (!again) updateId++;
      const base = { message_id: updateId, date: 0, chat: { id: TG, type: "private" }, from };
      let update: Record<string, unknown>;
      if ("repeat" in i) update = lastUpdate ?? { update_id: updateId };
      else if ("button" in i)
        update = {
          update_id: updateId,
          callback_query: { id: String(updateId), from, data: i.button, message: base },
        };
      else {
        const body =
          "text" in i
            ? { text: i.text }
            : "late" in i
              ? { text: i.late, date: Math.floor((Date.now() - i.minutes * 60_000) / 1000) }
              : "voice" in i
                ? { voice: { file_id: "v1", duration: 3 } }
                : "sticker" in i
                  ? { sticker: { file_id: "s1" } }
                  : { photo: [{ file_id: "p1", width: 10, height: 10 }] };
        update = { update_id: updateId, message: { ...base, ...body } };
      }
      lastUpdate = update;
      // Как маршрут /api/telegram/<бот>: повтор того же update_id не обрабатывается.
      if (!(await claimTelegramUpdate(ctx, updateId))) return;
      await handleTelegramUpdate(ctx, api, update as never);
    },
    replies: () => messages().map(([, p]) => plain(String(p.text ?? ""))),
    buttons: () => {
      const last = messages().at(-1);
      return last ? buttonsOf(last[1]) : [];
    },
    cart: () => (db.tables.cart_items ?? []).map((c) => String(c.product_id)),
    state: () => db.tables.bot_users![0]!.state as Record<string, unknown>,
    sellerNotices: () => notices.count,
    sellerTyped() {
      throw new Error("в Telegram продавец не пишет руками в диалог бота");
    },
  };
}

/**
 * База в памяти не умеет вложенный выбор «корзина → товар»: после каждой реплики
 * кладём в строки корзины сам товар, как это сделал бы запрос с join.
 */
function withCartJoin(r: Room): Room {
  // И внутри одной реплики: быстрая покупка кладёт товар и сразу оформляет заказ.
  const tables = r.db.tables as Record<string, Record<string, unknown>[] | undefined>;
  let cart = tables.cart_items;
  Object.defineProperty(tables, "cart_items", {
    configurable: true,
    enumerable: true,
    get() {
      for (const c of cart ?? []) {
        if (c.products) continue;
        c.products = r.db.tables.products?.find((p) => p.id === c.product_id) ?? null;
        c.product_variants = null;
      }
      return cart;
    },
    set(v) {
      cart = v;
    },
  });
  // Заказ с позициями — как select("*, order_items(*)") после оформления.
  let orders = tables.orders;
  Object.defineProperty(tables, "orders", {
    configurable: true,
    enumerable: true,
    get() {
      for (const o of orders ?? []) {
        const items = (r.db.tables.order_items ?? []).filter((i) => i.order_id === o.id);
        if (items.length) o.order_items = items;
      }
      return orders;
    },
    set(v) {
      orders = v;
    },
  });
  const say = r.say.bind(r);
  r.say = async (i) => {
    await say(i);
    for (const c of r.db.tables.cart_items ?? []) {
      if (c.products) continue;
      c.products = r.db.tables.products?.find((p) => p.id === c.product_id) ?? null;
      c.product_variants = null;
    }
  };
  return r;
}

export function room(o: RoomOptions): Room {
  return withCartJoin(o.channel === "telegram" ? telegramRoom(o) : directRoom(o));
}
