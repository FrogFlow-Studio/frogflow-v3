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
  /**
   * WhatsApp: кнопка шаблона (рассылки). Приходит простым событием `button`,
   * interactiveType пуст. Без своего payload Meta кладёт сюда текст кнопки.
   */
  buttonPayload?: string;
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
    /** Id сообщения у Meta: по нему Zernio заново выдаёт ссылку на вложение. */
    platformMessageId?: string;
    conversationId?: string;
    platform?: string;
    direction?: "incoming" | "outgoing" | string;
    text?: string | null;
    attachments?: Array<{
      type?: string;
      url?: string;
      mimeType?: string;
      payload?: Record<string, Json>;
      [key: string]: Json | undefined;
    }>;
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
    /** Чем отправлено исходящее: null/«human» — человек, остальное — бот и сценарии Zernio. */
    sentVia?: string | null;
    automationId?: string | null;
    workflowId?: string | null;
    sequenceId?: string | null;
    broadcastId?: string | null;
    executionId?: string | null;
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
    /** Профиль Zernio: в отличие от id аккаунта, не меняется при переподключении. */
    profileId?: string;
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
  /** Id сообщения у Meta — для повторного чтения вложения (ссылки CDN Instagram живут недолго). */
  platformMessageId: string | null;
  /**
   * mimeType — только когда Zernio его прислал (WhatsApp-медиа). index — место
   * вложения в исходном списке события (нужно для повторного чтения).
   */
  attachments: Array<{ type: string; url: string; mimeType?: string; index: number }>;
  /** Вложение пришло, но ссылки на него не нашлось — чек нельзя молча терять. */
  mediaWithoutUrl: boolean;
  /** Ответ на сторис или рилс: id медиа из метаданных Zernio (форма поля у них плавает). */
  storyId: string | null;
  /** Ссылка на медиа сторис — запасной ключ для сопоставления с тегом товара. */
  storyMediaUrl: string | null;
  /**
   * Подпись публикации, если Zernio её прислал: у пересланного рилса или поста
   * она лежит в `payload.title`. BOVI 25.09–09.10: восемь человек начали с
   * «Цена?» на рилс, и ИИ, не зная, о чём речь, переспрашивал.
   */
  storyCaption: string | null;
  /** Исходящее (наш же ответ, если Zernio когда-нибудь начнёт их слать) — не обрабатываем. */
  outgoing: boolean;
  /** Только у исходящего: кто отправил (см. `ZernioInboxMessage.sentVia`); нет поля — неизвестно. */
  sentVia?: string | null;
  /** Исходящее ушло сценарием Zernio (автоответ, цепочка, рассылка), а не человеком. */
  fromScenario?: boolean;
  /** Время сообщения по часам Zernio (ISO), если пришло. */
  sentAt?: string | null;
};

const STORY_ID_PATHS = [
  ["storyReply", "storyId"],
  ["storyReply", "story_id"],
  ["storyReply", "id"],
  ["story_reply", "story_id"],
  ["story_reply", "storyId"],
  ["story_reply", "id"],
  ["reelReply", "reelId"],
  ["reelReply", "id"],
  ["storyId"],
  ["story_id"],
  ["reelId"],
  ["story", "id"],
  ["reel", "id"],
];
const STORY_URL_PATHS = [
  ["storyReply", "storyUrl"],
  ["storyReply", "story_url"],
  ["storyReply", "url"],
  ["storyReply", "mediaUrl"],
  ["story_reply", "story_url"],
  ["story_reply", "url"],
  ["storyUrl"],
  ["story_url"],
  ["story", "url"],
  ["story", "mediaUrl"],
];
/** Ссылка на публикацию Instagram — рилс, пост или сторис, а не файл покупателя. */
const PUBLICATION_URL = /instagram\.com\/(?:reels?|p|stories)\//i;
const SHORTCODE = /instagram\.com\/(?:reels?|p)\/([\w-]+)/i;
/** Подпись публикации для модели: сути хватает начала, длинный текст — лишние токены. */
const STORY_CAPTION_MAX = 800;
const STORY_ATTACHMENT_TYPES = new Set([
  "story",
  "story_mention",
  "story_reply",
  "ig_story",
  "reel",
]);

/**
 * Где у вложения лежит ссылка. Instagram через Zernio присылает её то в
 * `url`, то в `payload.url` (форма Messenger), WhatsApp — в `url` или в
 * объекте медиа; смотрим во все места, иначе чек молча теряется.
 */
const ATTACHMENT_URL_PATHS = [
  ["url"],
  ["payload", "url"],
  ["mediaUrl"],
  ["media_url"],
  ["fileUrl"],
  ["file_url"],
  ["payload", "mediaUrl"],
  ["payload", "src"],
  ["media", "url"],
  ["image", "url"],
  ["document", "url"],
  ["file", "url"],
  ["link"],
];
const ATTACHMENT_MIME_PATHS = [
  ["mimeType"],
  ["mime_type"],
  ["payload", "mimeType"],
  ["payload", "mime_type"],
  ["media", "mimeType"],
  ["image", "mime_type"],
  ["document", "mime_type"],
];

function pick(obj: unknown, paths: readonly string[][]): string | null {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path)
      cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined;
    if (typeof cur === "string" && cur.trim()) return cur.trim();
    if (typeof cur === "number") return String(cur);
  }
  return null;
}

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
  const text = (message.text ?? "").trim();
  const interactiveType = str(interactive.interactiveType).trim();
  const interactiveId = str(interactive.interactiveId).trim();
  if (interactiveId === "0" || str(interactive.postbackPayload).trim() === "0")
    metadata.zernioOpaqueButtonTap = true;
  // Кнопка шаблона WhatsApp: свой payload — нажатие; равный тексту кнопки —
  // просто слова покупателя (так их увидят «Стоп»/«Отписаться» и слова-вызовы).
  // Без текста кнопки сравнить не с чем: нажатием считаем только наш вид
  // постбэка («CATALOG», «PROD:…»), остальное — словами.
  const templatePayload = str(interactive.buttonPayload).trim();
  const templateTap =
    templatePayload &&
    (text ? templatePayload !== text : /^[A-Z][A-Z_]*(:.*)?$/.test(templatePayload))
      ? templatePayload
      : "";
  const rawPostbackPayload =
    str(interactive.postbackPayload) ||
    (INTERACTIVE_TAP_TYPES.has(interactiveType) ? interactiveId : "") ||
    templateTap ||
    null;
  // В некоторых ответах Zernio присылает "0" вместо id действия; это не наш
  // postback. Оставляем видимый текст кнопки, чтобы роутер разобрал его по шагу чата.
  const postbackPayload = rawPostbackPayload === "0" ? null : rawPostbackPayload;

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

  const rawAttachments = Array.isArray(message.attachments) ? message.attachments : [];
  const attachments = rawAttachments
    .map((a, index) => {
      const url = pick(a, ATTACHMENT_URL_PATHS) ?? "";
      const mimeType = pick(a, ATTACHMENT_MIME_PATHS)?.toLowerCase();
      return {
        type: str(a?.type).toLowerCase() || "file",
        url: /^https?:\/\//i.test(url) ? url : "",
        ...(mimeType ? { mimeType } : {}),
        index,
      };
    })
    .filter((a) => a.url);

  // Ответ на сторис: id и ссылка живут в metadata события, message.metadata или в самом
  // сообщении — Zernio менял форму не раз, поэтому смотрим во все три места.
  const storySources = [payload.metadata, message.metadata, message, payload];
  let storyId: string | null = null;
  let storyMediaUrl: string | null = null;
  let storyCaption: string | null = null;
  for (const src of storySources) {
    storyId ??= pick(src, STORY_ID_PATHS);
    storyMediaUrl ??= pick(src, STORY_URL_PATHS);
  }
  storyMediaUrl ??= attachments.find((a) => STORY_ATTACHMENT_TYPES.has(a.type))?.url ?? null;
  // Ответ на рилс приходит вложением video со ссылкой на рилс (v1 9c92003):
  // { type: "video", url: ".../reel/<шорткод>/", payload: { reel_video_id } }.
  // Идентификатор — шорткод (его кладёт в привязку панель), reel_video_id —
  // запасной. Фото и видео покупателя публикацией не считаются (v1 0f974b6).
  if (!storyId || !storyMediaUrl) {
    for (const a of rawAttachments) {
      const type = str(a?.type).toLowerCase();
      const p = (a?.payload && typeof a.payload === "object" ? a.payload : {}) as Record<
        string,
        unknown
      >;
      const url = str(a?.url) || str(p.url);
      const published = PUBLICATION_URL.test(url);
      const reelId =
        str(p.reel_video_id) || str(p.reelVideoId) || str(p.reel_id) || str(p.story_id);
      if (!published && !reelId) continue;
      if (type && !["video", "image", "reel", "share", "ig_reel"].includes(type) && !published)
        continue;
      storyId ??= url.match(SHORTCODE)?.[1] ?? (reelId || null);
      if (published) storyMediaUrl ??= url;
      storyCaption ??= str(p.title).trim() || str(p.caption).trim() || null;
      if (storyId && storyMediaUrl) break;
    }
  }

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
    text: text || (postbackPayload ? "" : templatePayload),
    metadata,
    postbackPayload,
    nativeOrder,
    platformMessageId: str(message.platformMessageId) || null,
    attachments,
    mediaWithoutUrl: attachments.length < rawAttachments.length,
    storyId,
    storyMediaUrl,
    storyCaption: storyCaption ? storyCaption.slice(0, STORY_CAPTION_MAX) : null,
    outgoing: message.direction === "outgoing",
    ...(message.sentVia !== undefined ? { sentVia: message.sentVia } : {}),
    fromScenario: Boolean(
      message.automationId ||
      message.workflowId ||
      message.sequenceId ||
      message.broadcastId ||
      message.executionId,
    ),
    sentAt: message.sentAt ?? null,
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
  // Вложение без ссылки — не пустое сообщение: на шаге оплаты магазин просит
  // прислать чек ещё раз, иначе оно дойдёт до продавца, а не пропадёт молча.
  if (m.mediaWithoutUrl) return "[вложение без ссылки]";
  return "";
}
