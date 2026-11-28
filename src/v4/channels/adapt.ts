import { serverFailure } from "@/lib/server-failure";
import type { AgentModel } from "../agent/model";
import { isParkedModel } from "../agent/model";
import type { IncomingMedia, Transcriber } from "../agent/media";
import type { AgentMode } from "../agent/conversation";
import { runAgent } from "../agent/run";
import type { V4Db } from "../core/db";
import { claimInbound, sellerReply } from "../core/depth";
import { touchBuyer } from "../core/platform";
import { createOffer, pressBuy } from "../seller/offers";
import { sellerRole } from "../seller/role";
import { acceptComment } from "./comments";
import {
  handleTelegramUpdate,
  marketingAllowed,
  parseTelegramUpdate,
  type BuyerChannel,
} from "./inbound";

/**
 * Тонкий адаптер каналов. Разбирает сообщение и зовёт ядро.
 * Без флажка ИИ текст в runAgent не попадает. Записанная модель передаётся
 * снаружи; живой API этот файл не импортирует.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELLER_REPLY = /^reply:([0-9a-f-]{36})\s+([\s\S]+)$/i;

export type AdaptResult =
  | { kind: "ignore" }
  | { kind: "duplicate" }
  | { kind: "order"; buyerId: string; orderId: string; reused: boolean }
  | {
      kind: "offer";
      buyerId: string;
      offerId: string;
      currency: string;
      totalMinor: number;
      title: string;
      /** Товар карточки: кнопка «Открыть» ведёт на него в Mini App. */
      productId?: string;
    }
  | { kind: "receipt"; buyerId: string; orderId: string }
  | { kind: "buttons"; buyerId: string; text: string }
  | { kind: "comment"; buyerId: string; verdict: string }
  | { kind: "reply"; buyerId: string; text: string }
  | { kind: "seller_reply"; wrote: boolean }
  | { kind: "silent"; reason: string }
  | { kind: "refused"; code: string };

async function buyerAiOn(db: V4Db, botId: string): Promise<boolean> {
  const rows = await db.call("seller_readiness", { p_bot_id: botId });
  const raw = rows[0]?.seller_readiness;
  if (raw == null) return false;
  const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as { ai_on?: boolean };
  return r.ai_on === true;
}

async function once(db: V4Db, botId: string, channel: string, claimId: string): Promise<boolean> {
  return claimInbound(db, { botId, channel, externalId: claimId });
}

/** Сорвавшаяся обработка снимает заявку: повтор вебхука — не «уже было». */
async function claimed<T>(
  db: V4Db,
  botId: string,
  channel: string,
  claimId: string,
  work: () => Promise<T>,
): Promise<T | { kind: "duplicate" }> {
  if (!(await once(db, botId, channel, claimId))) return { kind: "duplicate" };
  try {
    return await work();
  } catch (e) {
    await db.call("release_inbound", {
      p_bot_id: botId,
      p_channel: channel,
      p_external_id: claimId,
    });
    throw e;
  }
}

const markupState = {
  lastGoodBp: null as number | null,
  cache: null as { at: number; bp: number } | null,
};

/** Процент оператора. Ошибка чтения бросается, чтобы сработал запасной путь и дело. */
async function shopMarkupBp(db: V4Db, botId: string): Promise<number> {
  const { markupBp, v4MarkupSource } = await import("../agent/wallet");
  const { serviceDb } = await import("@/core/db/client.server");
  const readPercent = async () => {
    const { data, error } = await serviceDb()
      .from("operator_settings")
      .select("value")
      .eq("key", "ai_markup_percent")
      .maybeSingle();
    if (error) throw serverFailure(error.message);
    if (!data || data.value == null || data.value === "")
      throw new Error("ai_markup_percent missing");
    const n = Number(data.value);
    if (!Number.isFinite(n)) throw new Error("ai_markup_percent bad");
    return n;
  };
  return (await markupBp(v4MarkupSource(db, readPercent, botId), markupState)).bp;
}

/** Карточка с ценой на 72 часа. Заказа ещё нет: его создаёт нажатие на код. */
async function showOffer(
  db: V4Db,
  input: {
    botId: string;
    channel: BuyerChannel;
    externalId: string;
    country: string | null;
    productId: string;
    mode?: AgentMode;
  },
): Promise<AdaptResult> {
  const buyerId = await touchBuyer(db, {
    botId: input.botId,
    channel: input.channel,
    externalId: input.externalId,
    country: input.country,
  });
  const made = await createOffer(db, {
    botId: input.botId,
    buyerId,
    productIds: [input.productId],
    mode: input.mode ?? "live",
  });
  if (!made.ok) return { kind: "refused", code: made.reason };
  return {
    kind: "offer",
    buyerId,
    offerId: made.offer.offerId,
    currency: made.offer.currency,
    totalMinor: made.offer.totalMinor,
    title: made.offer.items[0]?.title ?? "",
    productId: input.productId,
  };
}

/** Восемь нажатий одного кода — один заказ. Модель не вызывается. */
async function claimShown(
  db: V4Db,
  input: {
    botId: string;
    channel: BuyerChannel;
    externalId: string;
    country: string | null;
    offerId: string;
  },
): Promise<AdaptResult> {
  const buyerId = await touchBuyer(db, {
    botId: input.botId,
    channel: input.channel,
    externalId: input.externalId,
    country: input.country,
  });
  const pressed = await pressBuy(db, {
    botId: input.botId,
    buyerId,
    offerId: input.offerId.toUpperCase(),
  });
  if (pressed.kind === "order")
    return { kind: "order", buyerId, orderId: pressed.orderId, reused: pressed.reused };
  if (pressed.kind === "new_offer")
    return {
      kind: "offer",
      buyerId,
      offerId: pressed.offer.offerId,
      currency: pressed.offer.currency,
      totalMinor: pressed.offer.totalMinor,
      title: pressed.offer.items[0]?.title ?? "",
      productId: pressed.offer.items[0]?.productId,
    };
  return { kind: "refused", code: pressed.reason };
}

export async function adaptTelegram(
  db: V4Db,
  input: {
    botId: string;
    update: Parameters<typeof parseTelegramUpdate>[0];
    claimId: string;
    model: AgentModel;
    mode?: AgentMode;
    media?: IncomingMedia;
    transcribe?: Transcriber;
    country?: string | null;
    /** Чаты продавца. reply: принимает только отсюда, не от любого покупателя. */
    sellerChatIds?: readonly string[];
    loadFile?: (fileId: string) => Promise<Uint8Array | null>;
    saveFile?: (path: string, bytes: Uint8Array) => Promise<void>;
    /** Наценка в базисных пунктах. Без неё читается настройка оператора. */
    markupBp?: () => Promise<number>;
    /** Сервисная роль: расчёт брони. Арендатор цену не передаёт. */
    walletDb?: V4Db;
  },
): Promise<AdaptResult> {
  return claimed(db, input.botId, "telegram", input.claimId, () => adaptTelegramBody(db, input));
}

async function adaptTelegramBody(
  db: V4Db,
  input: {
    botId: string;
    update: Parameters<typeof parseTelegramUpdate>[0];
    claimId: string;
    model: AgentModel;
    mode?: AgentMode;
    media?: IncomingMedia;
    transcribe?: Transcriber;
    country?: string | null;
    sellerChatIds?: readonly string[];
    loadFile?: (fileId: string) => Promise<Uint8Array | null>;
    saveFile?: (path: string, bytes: Uint8Array) => Promise<void>;
    markupBp?: () => Promise<number>;
    walletDb?: V4Db;
  },
): Promise<AdaptResult> {
  const intent = parseTelegramUpdate(input.update);
  if (intent.type === "ignore") return { kind: "ignore" };
  const sellers = new Set(input.sellerChatIds ?? []);
  const reply = intent.type === "text" ? SELLER_REPLY.exec(intent.text) : null;
  if (reply && UUID.test(reply[1]!) && sellers.has(intent.chatId)) {
    const wrote = await sellerReply(db, {
      botId: input.botId,
      caseId: reply[1]!,
      text: reply[2]!.trim(),
      by: "telegram",
    });
    if (!wrote.ok) return { kind: "refused", code: wrote.code };
    return { kind: "seller_reply", wrote: wrote.value };
  }
  if (intent.type === "offer") {
    return claimShown(db, {
      botId: input.botId,
      channel: "telegram",
      externalId: intent.chatId,
      country: input.country ?? null,
      offerId: intent.offerId,
    });
  }
  if (intent.type === "buy") {
    return showOffer(db, {
      botId: input.botId,
      channel: "telegram",
      externalId: intent.chatId,
      country: input.country ?? null,
      productId: intent.productId,
      mode: input.mode,
    });
  }
  const ai = await buyerAiOn(db, input.botId);
  if (intent.type === "receipt" || (input.media?.kind === "photo" && !ai)) {
    const receipt = await handleTelegramUpdate(db, {
      botId: input.botId,
      update: input.update,
      country: input.country,
      ...(input.loadFile ? { loadFile: input.loadFile } : {}),
      ...(input.saveFile ? { saveFile: input.saveFile } : {}),
    });
    if (receipt.type === "receipt")
      return { kind: "receipt", buyerId: receipt.buyerId, orderId: receipt.orderId };
    if (receipt.type === "refused") return { kind: "refused", code: receipt.code };
    return { kind: "refused", code: "order_not_found" };
  }
  if (intent.type !== "text" && !input.media) return { kind: "ignore" };
  const externalId = intent.chatId;
  const text = intent.type === "text" ? intent.text : "";
  const buyerId = await touchBuyer(db, {
    botId: input.botId,
    channel: "telegram",
    externalId,
    country: input.country ?? null,
  });
  if (!ai) return { kind: "buttons", buyerId, text };
  if (isParkedModel(input.model)) return { kind: "silent", reason: "model_parked" };
  const result = await runAgent({
    db,
    role: sellerRole(),
    model: input.model,
    markupBp: input.markupBp ?? (() => shopMarkupBp(db, input.botId)),
    ...(input.walletDb ? { walletDb: input.walletDb } : {}),
    botId: input.botId,
    buyerId,
    mode: input.mode ?? "live",
    channel: "telegram",
    externalId: input.claimId,
    text,
    sleep: async () => undefined,
    ...(input.media ? { media: input.media } : {}),
    ...(input.transcribe ? { transcribe: input.transcribe } : {}),
  });
  if (result.kind === "silent") return { kind: "silent", reason: result.reason };
  return { kind: "reply", buyerId, text: result.replies[0]?.text ?? "" };
}

export async function adaptComment(
  db: V4Db,
  input: {
    botId: string;
    claimId: string;
    externalId: string;
    postId: string | null;
    commenterId: string;
    text: string;
    commentedAt: Date;
  },
): Promise<AdaptResult> {
  return claimed(db, input.botId, "instagram", input.claimId, async () => {
    const row = await acceptComment(db, input);
    return { kind: "comment" as const, buyerId: row.buyerId, verdict: row.verdict };
  });
}

export async function adaptDirect(
  db: V4Db,
  input: {
    botId: string;
    channel: BuyerChannel;
    claimId: string;
    externalId: string;
    text: string;
    productId?: string;
    offerId?: string;
    model: AgentModel;
    mode?: AgentMode;
    country?: string | null;
    walletDb?: V4Db;
  },
): Promise<AdaptResult> {
  return claimed(db, input.botId, input.channel, input.claimId, () => adaptDirectBody(db, input));
}

async function adaptDirectBody(
  db: V4Db,
  input: {
    botId: string;
    channel: BuyerChannel;
    claimId: string;
    externalId: string;
    text: string;
    productId?: string;
    offerId?: string;
    model: AgentModel;
    mode?: AgentMode;
    country?: string | null;
    walletDb?: V4Db;
  },
): Promise<AdaptResult> {
  if (input.offerId && /^[A-HJ-NP-Z2-9]{8}$/i.test(input.offerId)) {
    return claimShown(db, {
      botId: input.botId,
      channel: input.channel,
      externalId: input.externalId,
      country: input.country ?? null,
      offerId: input.offerId,
    });
  }
  if (input.productId && UUID.test(input.productId)) {
    return showOffer(db, {
      botId: input.botId,
      channel: input.channel,
      externalId: input.externalId,
      country: input.country ?? null,
      productId: input.productId,
      mode: input.mode,
    });
  }
  const ai = await buyerAiOn(db, input.botId);
  const buyerId = await touchBuyer(db, {
    botId: input.botId,
    channel: input.channel,
    externalId: input.externalId,
    country: input.country ?? null,
  });
  if (!ai || isParkedModel(input.model)) {
    return ai
      ? { kind: "silent", reason: "model_parked" }
      : { kind: "buttons", buyerId, text: input.text };
  }
  const result = await runAgent({
    db,
    role: sellerRole(),
    model: input.model,
    markupBp: () => shopMarkupBp(db, input.botId),
    ...(input.walletDb ? { walletDb: input.walletDb } : {}),
    botId: input.botId,
    buyerId,
    mode: input.mode ?? "live",
    channel: input.channel === "web" ? "web" : input.channel,
    externalId: input.claimId,
    text: input.text,
    sleep: async () => undefined,
  });
  if (result.kind === "silent") return { kind: "silent", reason: result.reason };
  return { kind: "reply", buyerId, text: result.replies[0]?.text ?? "" };
}

/** Маркетинг вне ответа. У WhatsApp закрыто, если покупатель молчит дольше 24 часов. */
export function marketingOpen(
  db: V4Db,
  input: { botId: string; channel: BuyerChannel; externalId: string; now?: Date },
): Promise<boolean> {
  return marketingAllowed(db, input);
}

export type ZernioIntent =
  | { type: "buy"; channel: "instagram" | "whatsapp"; externalId: string; productId: string }
  | { type: "offer"; channel: "instagram" | "whatsapp"; externalId: string; offerId: string }
  | { type: "text"; channel: "instagram" | "whatsapp"; externalId: string; text: string }
  | {
      type: "comment";
      externalId: string;
      postId: string | null;
      commenterId: string;
      text: string;
    }
  | { type: "ignore" };

/** Разбор события Zernio без записи. Кнопка товара — `buy:<uuid>`, карточка — `offer:<код>`. */
export function zernioIntent(payload: {
  id?: string;
  event?: string;
  message?: {
    platform?: string;
    text?: string | null;
    sender?: { id?: string };
    metadata?: { postbackPayload?: string; buttonPayload?: string };
  };
  post?: { id?: string; platformPostId?: string };
  comment?: {
    id?: string;
    postId?: string | null;
    platformPostId?: string;
    commenterId?: string;
    text?: string;
    author?: { id?: string; username?: string };
  };
}): ZernioIntent {
  if (payload.event === "comment.received" && payload.comment?.text) {
    const commenterId =
      payload.comment.commenterId || payload.comment.author?.id || payload.comment.author?.username;
    if (commenterId) {
      return {
        type: "comment",
        externalId: payload.comment.id || commenterId,
        postId:
          payload.comment.postId ||
          payload.comment.platformPostId ||
          payload.post?.id ||
          payload.post?.platformPostId ||
          null,
        commenterId,
        text: payload.comment.text,
      };
    }
  }
  const platform = payload.message?.platform;
  const channel = platform === "whatsapp" || platform === "instagram" ? platform : null;
  const externalId = payload.message?.sender?.id;
  if (!channel || !externalId) return { type: "ignore" };
  const button =
    payload.message?.metadata?.postbackPayload ?? payload.message?.metadata?.buttonPayload ?? "";
  const offer = /^offer:([A-HJ-NP-Z2-9]{8})$/i.exec(button);
  if (offer) return { type: "offer", channel, externalId, offerId: offer[1]!.toUpperCase() };
  const buy = /^buy:([0-9a-f-]{36})$/i.exec(button);
  if (buy && UUID.test(buy[1]!)) return { type: "buy", channel, externalId, productId: buy[1]! };
  const text = payload.message?.text?.trim();
  if (text) return { type: "text", channel, externalId, text };
  return { type: "ignore" };
}
