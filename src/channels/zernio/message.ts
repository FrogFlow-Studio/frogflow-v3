import type { Json } from "@/core/db-types";
import { isZernioPlatform, type ZernioPlatform } from "./platform";

/**
 * Событие `message.received` в том виде, в каком его присылает Zernio.
 * Форма выверена по журналу v1 (`zernio_logs`, 26 865 событий): профиль
 * отправителя лежит в `message.sender.instagramProfile`, нажатие кнопки — в
 * корне события (`metadata`), а `text` бывает null у сообщения с одним
 * вложением. Разбор — без побочных действий, чтобы его проверял тест.
 */
export type ZernioInteractiveMetadata = {
  /** Instagram: нажатие кнопки postback. */
  postbackPayload?: string;
  /** WhatsApp: строка списка или кнопка. */
  interactiveType?: string;
  interactiveId?: string;
  interactiveTitle?: string;
  /** WhatsApp: корзина из нативного каталога Meta. */
  order?: {
    catalog_id?: string;
    text?: string;
    product_items?: Array<{
      product_retailer_id?: string;
      quantity?: number;
      item_price?: number;
      currency?: string;
    }>;
  };
  [key: string]: Json | undefined;
};

export type ZernioWebhookMessagePayload = {
  /** Стабильный идентификатор события — ключ дедупликации. */
  id?: string;
  event: string;
  message?: {
    id?: string;
    conversationId?: string;
    platform?: string;
    direction?: "incoming" | "outgoing" | string;
    text?: string | null;
    attachments?: Array<{ type?: string; url?: string; payload?: Record<string, Json> }>;
    sender?: {
      id?: string;
      contactId?: string;
      name?: string;
      username?: string;
      phoneNumber?: string | null;
      instagramProfile?: Record<string, Json>;
    };
    metadata?: ZernioInteractiveMetadata;
    sentAt?: string;
  };
  conversation?: {
    id?: string;
    participantId?: string;
    participantName?: string;
    participantUsername?: string;
  };
  account?: {
    id?: string;
    _id?: string;
    accountId?: string;
    platform?: string;
    username?: string;
  };
  metadata?: ZernioInteractiveMetadata;
  timestamp?: string;
};

export type NativeOrder = {
  catalogId: string;
  note: string;
  items: Array<{ retailerId: string; quantity: number; price: number; currency: string }>;
};

export type ParsedZernioMessage = {
  conversationId: string | null;
  accountId: string | null;
  platform: ZernioPlatform;
  /** Идентификатор отправителя в канале — из него собирается user_key (`ig_…`/`wa_…`). */
  senderId: string;
  senderUsername: string;
  senderName: string;
  /** Телефон WhatsApp в E.164, когда Meta его отдала; пусто для Instagram. */
  senderPhone: string;
  text: string;
  /** Профиль подписчика плюс id карточки в CRM Zernio — в bot_users.metadata. */
  metadata: Record<string, Json>;
  /** Нажатие кнопки или строки списка — у такого сообщения текста нет. */
  postbackPayload: string | null;
  nativeOrder: NativeOrder | null;
  attachments: Array<{ type: string; url: string }>;
  /** Исходящее (наш же ответ, если Zernio когда-нибудь начнёт их слать) — не обрабатываем. */
  outgoing: boolean;
};

const FALLBACK_NAME = "друг";
const INTERACTIVE_TAP_TYPES = new Set(["postback", "button_reply", "list_reply"]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function parseZernioMessage(payload: ZernioWebhookMessagePayload): ParsedZernioMessage {
  const message = payload.message ?? {};
  const conversation = payload.conversation ?? {};
  const account = payload.account ?? {};
  const sender = message.sender ?? {};

  const platform: ZernioPlatform = isZernioPlatform(account.platform)
    ? account.platform
    : isZernioPlatform(message.platform)
      ? message.platform
      : "instagram";

  const senderId = sender.id || sender.username || conversation.participantId || "unknown";
  const senderUsername = sender.username || conversation.participantUsername || "";
  const senderName = sender.name || conversation.participantName || senderUsername || FALLBACK_NAME;
  const senderPhone =
    sender.phoneNumber || (/^\+?\d{10,15}$/.test(sender.id ?? "") ? (sender.id ?? "") : "");

  const metadata: Record<string, Json> = { ...(sender.instagramProfile ?? {}) };
  if (sender.contactId) metadata.zernioContactId = String(sender.contactId);

  // Настоящее место нажатия — корень события; message.metadata — запасное чтение.
  const interactive = payload.metadata ?? message.metadata ?? {};
  const postbackPayload =
    str(interactive.postbackPayload) ||
    (INTERACTIVE_TAP_TYPES.has(str(interactive.interactiveType))
      ? str(interactive.interactiveId)
      : "") ||
    null;

  const order = interactive.order;
  const nativeOrder: NativeOrder | null = order
    ? {
        catalogId: String(order.catalog_id ?? ""),
        note: (order.text ?? "").trim(),
        items: (order.product_items ?? []).map((item) => ({
          retailerId: String(item.product_retailer_id ?? ""),
          quantity: Number(item.quantity ?? 0),
          price: Number(item.item_price ?? 0),
          currency: String(item.currency ?? ""),
        })),
      }
    : null;

  const attachments = (message.attachments ?? [])
    .map((a) => ({ type: str(a.type).toLowerCase() || "file", url: str(a.url) }))
    .filter((a) => a.url);

  return {
    conversationId: message.conversationId || conversation.id || null,
    // accountId — каноническое поле; id и mongo-style _id — запасные.
    accountId: account.accountId || account.id || account._id || null,
    platform,
    senderId,
    senderUsername,
    senderName,
    senderPhone,
    // text приходит null у сообщения с одним вложением — это не отсутствие поля.
    text: (message.text ?? "").trim(),
    metadata,
    postbackPayload,
    nativeOrder,
    attachments,
    outgoing: message.direction === "outgoing",
  };
}

/** Текст сообщения для журнала и консультанта: слова, нажатие, корзина или вложение. */
export function messageAsText(m: ParsedZernioMessage): string {
  if (m.text) return m.text;
  if (m.postbackPayload) return m.postbackPayload;
  if (m.nativeOrder) {
    const items = m.nativeOrder.items
      .map((i) => `${i.retailerId} × ${i.quantity}`)
      .filter((s) => !s.startsWith(" ×"))
      .join(", ");
    return `Корзина из каталога WhatsApp: ${items || "без позиций"}${m.nativeOrder.note ? `. ${m.nativeOrder.note}` : ""}`;
  }
  if (m.attachments.length) return `[вложение: ${m.attachments.map((a) => a.type).join(", ")}]`;
  return "";
}
