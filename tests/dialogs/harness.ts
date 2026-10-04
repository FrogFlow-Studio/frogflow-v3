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

export type Channel = "telegram" | "instagram" | "whatsapp";

/** Что покупатель делает в диалоге. */
export type Input =
  | { text: string }
  | { button: string }
  | { voice: true }
  | { sticker: true }
  | { photo: true }
  /** Та же реплика ещё раз: двойная доставка вебхука или двойной клик. */
  | { repeat: true };

export interface Product {
  id: string;
  name: string;
  price?: number;
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
  /** Продавец ответил руками N минут назад (только Direct). */
  sellerTyped(minutesAgo: number): void;
  db: FakeDb;
}

export interface RoomOptions {
  channel: Channel;
  locale: Locale;
  products?: Product[];
  /** Начальное состояние покупателя (шаг, страна, …). */
  state?: Record<string, unknown>;
  modules?: Record<string, boolean>;
}

const BOT = "00000000-0000-4000-8000-0000000000aa";
export const notices = { count: 0 };

const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

const productRow = (p: Product, i: number) => ({
  id: p.id,
  bot_id: BOT,
  name: p.name,
  keywords: null,
  description: "",
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
  db.tables.bot_users = [
    {
      id: "u1",
      bot_id: BOT,
      user_key: key,
      platform,
      telegram_id: telegramId,
      opt_out: false,
      loyalty_points: 0,
      state: { locale: o.locale, country_code: "KZ", ...(o.state ?? {}) },
    },
  ];
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
      vertical: "digital",
      modules: o.modules ?? {},
      settings: { default_locale: o.locale },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { db, ctx };
}

function directRoom(o: RoomOptions): Room {
  const platform = o.channel as "instagram" | "whatsapp";
  const key = platform === "whatsapp" ? "wa_1" : "ig_1";
  const { db, ctx } = baseDb(o, key, platform, -1);
  const sent: Array<{ text: string; buttons: string[] }> = [];
  let mark = 0;
  let tail: unknown[] = [];
  let last: Input | null = null;
  const transport = {
    send: vi.fn(
      async (
        _c: string,
        _a: string,
        text: string,
        opts: { buttons?: Array<{ title?: string }> } = {},
      ) => {
        sent.push({ text: plain(text), buttons: (opts.buttons ?? []).map((b) => b.title ?? "") });
        return { ok: true };
      },
    ),
    tail: vi.fn(async () => tail),
    download: vi.fn(async () => null),
    mailReady: () => false,
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
      outgoing: false,
      ...m,
    }) as ParsedZernioMessage;
  const toMessage = (i: Input): Partial<ParsedZernioMessage> => {
    if ("text" in i) return { text: i.text };
    if ("button" in i) return { text: i.button, postbackPayload: i.button };
    const kind = "voice" in i ? "audio" : "sticker" in i ? "sticker" : "image";
    return { attachments: [{ type: kind, url: `https://cdn.test/${kind}`, index: 0 }] as never };
  };
  return {
    db,
    async say(i) {
      mark = sent.length;
      if ("repeat" in i) i = last ?? { text: "" };
      else last = i;
      const r = await handleShopMessage(ctx, current, parsed(toMessage(i)), transport);
      current = r.customer;
      current.state = db.tables.bot_users![0]!.state as Customer["state"];
    },
    replies: () => sent.slice(mark).map((s) => s.text),
    buttons: () => sent.slice(mark).flatMap((s) => s.buttons),
    cart: () => (db.tables.cart_items ?? []).map((c) => String(c.product_id)),
    state: () => db.tables.bot_users![0]!.state as Record<string, unknown>,
    sellerNotices: () => notices.count,
    sellerTyped(min) {
      tail = [
        {
          direction: "outgoing",
          message: "Здравствуйте! Сейчас отвечу",
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
  const buttonsOf = (p: Record<string, unknown>) =>
    (
      (p.reply_markup as { inline_keyboard?: Array<Array<{ text: string }>> } | undefined)
        ?.inline_keyboard ?? []
    )
      .flat()
      .map((b) => b.text);
  const messages = () => calls.slice(mark).filter(([m]) => m === "sendMessage");
  return {
    db,
    async say(i) {
      mark = calls.length;
      const again = "repeat" in i && lastUpdate !== null;
      if (!again) updateId++;
      const from = { id: TG, is_bot: false, first_name: "Анна" };
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

export function room(o: RoomOptions): Room {
  return o.channel === "telegram" ? telegramRoom(o) : directRoom(o);
}
