import { sha256Hex } from "@/lib/hash";
import { submitReceipt } from "../core/money/money";
import { placeOrder, replyWindowOpen, touchBuyer } from "../core/platform";
import type { V4Db } from "../core/db";
import type { Order } from "../core/money/money";

/**
 * Входящие Telegram, WhatsApp и витрины. Один и тот же заказ: touch_buyer и
 * place_order. Окно 24 часа проверяется только у WhatsApp.
 */

export type BuyerChannel = "telegram" | "instagram" | "whatsapp" | "web";

export type TelegramIntent =
  | { type: "text"; chatId: string; text: string }
  | { type: "buy"; chatId: string; productId: string }
  | { type: "offer"; chatId: string; offerId: string }
  | { type: "receipt"; chatId: string; fileId: string }
  | { type: "ignore" };

type TgMessage = {
  chat?: { id?: number | string };
  text?: string;
  photo?: Array<{ file_id?: string }>;
};
type TgUpdate = {
  message?: TgMessage;
  callback_query?: { data?: string; message?: TgMessage };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Разбор апдейта Telegram. Товар — `buy:<uuid>`, карточка с ценой — `offer:<код>`. */
export function parseTelegramUpdate(update: TgUpdate): TelegramIntent {
  const data = update.callback_query?.data ?? "";
  const offer = /^offer:([A-HJ-NP-Z2-9]{8})$/i.exec(data);
  const buy = /^buy:([0-9a-f-]{36})$/i.exec(data);
  const chatId = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;
  if (chatId == null) return { type: "ignore" };
  const id = String(chatId);
  if (offer) return { type: "offer", chatId: id, offerId: offer[1]!.toUpperCase() };
  if (buy && UUID.test(buy[1]!)) return { type: "buy", chatId: id, productId: buy[1]! };
  const photo = update.message?.photo?.at(-1)?.file_id;
  if (photo) return { type: "receipt", chatId: id, fileId: photo };
  const text = update.message?.text?.trim();
  if (text) return { type: "text", chatId: id, text };
  return { type: "ignore" };
}

export type InboundResult =
  | { type: "order"; buyerId: string; order: Order }
  | { type: "receipt"; buyerId: string; orderId: string }
  | { type: "text"; buyerId: string; text: string }
  | { type: "ignore" }
  | { type: "refused"; code: string };

/**
 * Покупка из канала. Покупатель создаётся один раз на внешний id.
 * Для учёта остатка вызывается place_order, не голый create_order.
 */
export async function checkout(
  db: V4Db,
  input: {
    botId: string;
    channel: BuyerChannel;
    externalId: string;
    country: string | null;
    productIds: string[];
    by: string;
    now?: Date;
  },
): Promise<InboundResult> {
  const buyerId = await touchBuyer(db, {
    botId: input.botId,
    channel: input.channel,
    externalId: input.externalId,
    country: input.country,
    ...(input.now ? { now: input.now } : {}),
  });
  if (input.channel === "whatsapp") {
    const open = await replyWindowOpen(db, {
      botId: input.botId,
      channel: input.channel,
      externalId: input.externalId,
      ...(input.now ? { now: input.now } : {}),
    });
    if (!open) return { type: "refused", code: "window_closed" };
  }
  const order = await placeOrder(db, {
    botId: input.botId,
    buyerId,
    country: input.country,
    productIds: input.productIds,
    by: input.by,
  });
  if (!order.ok) return { type: "refused", code: order.code };
  return { type: "order", buyerId, order: order.value };
}

/** Можно ли написать покупателю в WhatsApp не в ответ на его сообщение. */
export function marketingAllowed(
  db: V4Db,
  input: { botId: string; channel: BuyerChannel; externalId: string; now?: Date },
): Promise<boolean> {
  return replyWindowOpen(db, input);
}

export async function handleTelegramUpdate(
  db: V4Db,
  input: {
    botId: string;
    update: TgUpdate;
    country?: string | null;
    now?: Date;
    /** Байты файла. Без них чек не принимается: один и тот же отпечаток ломал бы проверку дубля. */
    loadFile?: (fileId: string) => Promise<Uint8Array | null>;
    saveFile?: (path: string, bytes: Uint8Array) => Promise<void>;
  },
): Promise<InboundResult> {
  const intent = parseTelegramUpdate(input.update);
  if (intent.type === "ignore") return { type: "ignore" };
  const buyerId = await touchBuyer(db, {
    botId: input.botId,
    channel: "telegram",
    externalId: intent.chatId,
    country: input.country ?? null,
    ...(input.now ? { now: input.now } : {}),
  });
  if (intent.type === "text") return { type: "text", buyerId, text: intent.text };
  // Кнопка товара и карточка идут через adapt: там цена на 72 часа, а не сразу заказ.
  if (intent.type === "offer" || intent.type === "buy") return { type: "ignore" };
  const bytes = input.loadFile ? await input.loadFile(intent.fileId) : null;
  if (!bytes || bytes.byteLength === 0) return { type: "refused", code: "receipt_unread" };
  const fingerprint = sha256Hex(bytes);
  const storagePath = `${input.botId}/receipt-${fingerprint}`;
  if (input.saveFile) {
    try {
      await input.saveFile(storagePath, bytes);
    } catch {
      return { type: "refused", code: "receipt_unread" };
    }
  }
  const open = await db.call("buyer_open_orders", { p_bot_id: input.botId, p_buyer_id: buyerId });
  const due = open.find((r) => Number(r.due_minor) > 0);
  if (!due) return { type: "refused", code: "order_not_found" };
  const orderId = String(due.order_id);
  const receipt = await submitReceipt(db, {
    botId: input.botId,
    orderId,
    storagePath,
    fingerprint,
    by: "telegram",
  });
  if (!receipt.ok) return { type: "refused", code: receipt.code };
  return { type: "receipt", buyerId, orderId };
}
