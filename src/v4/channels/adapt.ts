import type { AgentModel } from "../agent/model";
import { isParkedModel } from "../agent/model";
import type { IncomingMedia, Transcriber } from "../agent/media";
import { runAgent, type AgentMode } from "../agent/run";
import type { V4Db } from "../core/db";
import { claimInbound, sellerReply } from "../core/depth";
import { touchBuyer } from "../core/platform";
import { sellerRole } from "../seller/role";
import { acceptComment } from "./comments";
import {
  checkout,
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
  | { kind: "order"; buyerId: string; orderId: string }
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

async function once(
  db: V4Db,
  botId: string,
  channel: string,
  claimId: string,
): Promise<boolean> {
  return claimInbound(db, { botId, channel, externalId: claimId });
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
  },
): Promise<AdaptResult> {
  if (!(await once(db, input.botId, "telegram", input.claimId))) return { kind: "duplicate" };
  const intent = parseTelegramUpdate(input.update);
  if (intent.type === "ignore") return { kind: "ignore" };
  const reply = intent.type === "text" ? SELLER_REPLY.exec(intent.text) : null;
  if (reply && UUID.test(reply[1]!)) {
    const wrote = await sellerReply(db, {
      botId: input.botId,
      caseId: reply[1]!,
      text: reply[2]!.trim(),
      by: "telegram",
    });
    if (!wrote.ok) return { kind: "refused", code: wrote.code };
    return { kind: "seller_reply", wrote: wrote.value };
  }
  if (intent.type === "buy") {
    const order = await checkout(db, {
      botId: input.botId,
      channel: "telegram",
      externalId: intent.chatId,
      country: input.country ?? null,
      productIds: [intent.productId],
      by: "telegram",
    });
    if (order.type === "order")
      return { kind: "order", buyerId: order.buyerId, orderId: order.order.id };
    if (order.type === "refused") return { kind: "refused", code: order.code };
    return { kind: "refused", code: "order_not_found" };
  }
  const ai = await buyerAiOn(db, input.botId);
  if (intent.type === "receipt" || (input.media?.kind === "photo" && !ai)) {
    const receipt = await handleTelegramUpdate(db, {
      botId: input.botId,
      update: input.update,
      country: input.country,
    });
    if (receipt.type === "receipt")
      return { kind: "receipt", buyerId: receipt.buyerId, orderId: receipt.orderId };
    if (receipt.type === "refused") return { kind: "refused", code: receipt.code };
    return { kind: "refused", code: "order_not_found" };
  }
  if (intent.type !== "text" && !input.media) return { kind: "ignore" };
  const externalId = intent.type === "text" ? intent.chatId : input.claimId;
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
    markupBp: async () => 2500,
    botId: input.botId,
    buyerId,
    mode: input.mode ?? "test",
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
  if (!(await once(db, input.botId, "instagram", input.claimId))) return { kind: "duplicate" };
  const row = await acceptComment(db, input);
  return { kind: "comment", buyerId: row.buyerId, verdict: row.verdict };
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
    model: AgentModel;
    country?: string | null;
  },
): Promise<AdaptResult> {
  if (!(await once(db, input.botId, input.channel, input.claimId))) return { kind: "duplicate" };
  if (input.productId && UUID.test(input.productId)) {
    const order = await checkout(db, {
      botId: input.botId,
      channel: input.channel,
      externalId: input.externalId,
      country: input.country ?? null,
      productIds: [input.productId],
      by: input.channel,
    });
    if (order.type === "order")
      return { kind: "order", buyerId: order.buyerId, orderId: order.order.id };
    if (order.type === "refused") return { kind: "refused", code: order.code };
    return { kind: "refused", code: "order_not_found" };
  }
  const ai = await buyerAiOn(db, input.botId);
  const buyerId = await touchBuyer(db, {
    botId: input.botId,
    channel: input.channel,
    externalId: input.externalId,
    country: input.country ?? null,
  });
  if (!ai || isParkedModel(input.model)) {
    return ai ? { kind: "silent", reason: "model_parked" } : { kind: "buttons", buyerId, text: input.text };
  }
  const result = await runAgent({
    db,
    role: sellerRole(),
    model: input.model,
    markupBp: async () => 2500,
    botId: input.botId,
    buyerId,
    mode: "test",
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
  | { type: "text"; channel: "instagram" | "whatsapp"; externalId: string; text: string }
  | { type: "comment"; externalId: string; postId: string | null; commenterId: string; text: string }
  | { type: "ignore" };

/** Разбор события Zernio без записи. Кнопка — `buy:<uuid>`. */
export function zernioIntent(payload: {
  id?: string;
  event?: string;
  message?: {
    platform?: string;
    text?: string | null;
    sender?: { id?: string };
    metadata?: { postbackPayload?: string; buttonPayload?: string };
  };
  comment?: { id?: string; postId?: string | null; commenterId?: string; text?: string };
}): ZernioIntent {
  if (payload.event === "comment.received" && payload.comment?.commenterId && payload.comment.text) {
    return {
      type: "comment",
      externalId: payload.comment.id ?? payload.comment.commenterId,
      postId: payload.comment.postId ?? null,
      commenterId: payload.comment.commenterId,
      text: payload.comment.text,
    };
  }
  const platform = payload.message?.platform;
  const channel = platform === "whatsapp" || platform === "instagram" ? platform : null;
  const externalId = payload.message?.sender?.id;
  if (!channel || !externalId) return { type: "ignore" };
  const button = payload.message?.metadata?.postbackPayload ?? payload.message?.metadata?.buttonPayload ?? "";
  const buy = /^buy:([0-9a-f-]{36})$/i.exec(button);
  if (buy && UUID.test(buy[1]!)) return { type: "buy", channel, externalId, productId: buy[1]! };
  const text = payload.message?.text?.trim();
  if (text) return { type: "text", channel, externalId, text };
  return { type: "ignore" };
}
