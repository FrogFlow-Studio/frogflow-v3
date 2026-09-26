/** Чистая логика рассылок — без базы и без канала. */

export type AudienceType = "all" | "buyers" | "non_buyers" | "country" | "test";
export const AUDIENCE_TYPES: readonly AudienceType[] = [
  "all",
  "buyers",
  "non_buyers",
  "country",
  "test",
];

export type BroadcastStatus = "queued" | "sending" | "completed" | "cancelled" | "failed";

export type BroadcastContent = {
  text: string;
  /** Ключи картинок в бакете product-images (под префиксом клиента). */
  photoKeys: string[];
  /** Товары для кнопок под сообщением, не больше MAX_PRODUCT_BUTTONS. */
  productIds: string[];
  showCatalog: boolean;
};

export const MAX_PRODUCT_BUTTONS = 8;
export const MAX_PHOTOS = 10;
export const BATCH_SIZE = 25;
export const SEND_DELAY_MS = 80;
/**
 * Получатель, захваченный запуском крона, но так и не получивший итога
 * (функцию убили посреди отправки), через столько считается недоставленным.
 * Повторно не шлём: могло уйти, а второе сообщение хуже потерянного.
 */
export const CLAIM_STALE_MS = 15 * 60_000;
export const STALE_CLAIM_ERROR = "прервано во время отправки: доставка не подтверждена";

/**
 * «Этот человек больше недостижим» против «не вышло сейчас». Заблокировавшие
 * бота считаются отдельно и не выглядят поломкой рассылки.
 */
export function classifyDeliveryError(
  description: string | undefined | null,
): "blocked" | "failed" {
  const msg = (description ?? "").toLowerCase();
  if (
    msg.includes("blocked") ||
    msg.includes("deactivated") ||
    msg.includes("chat not found") ||
    msg.includes("user is deactivated") ||
    msg.includes("bot can't initiate") ||
    // WhatsApp (Meta): номер не в WhatsApp (131021) и получатель недоступен (131026).
    msg.includes("131021") ||
    msg.includes("131026") ||
    msg.includes("not a whatsapp user")
  )
    return "blocked";
  return "failed";
}

/** Завершённая рассылка, у которой не дошло ни одно сообщение, — failed. */
export function finalStatus(sentCount: number, totalCount: number): "completed" | "failed" {
  return sentCount === 0 && totalCount > 0 ? "failed" : "completed";
}

/** Настоящий чат Telegram: положительный id, а не синтетический ключ другого канала. */
export function isRealTelegramChat(id: unknown): id is number {
  return typeof id === "number" && Number.isFinite(id) && id > 0;
}

/** Обрезать название товара под кнопку. */
export function buttonLabel(name: string, max = 36): string {
  const s = name.trim() || "Товар";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function normalizeContent(input: BroadcastContent): BroadcastContent {
  return {
    text: input.text.trim(),
    photoKeys: Array.from(new Set(input.photoKeys.filter(Boolean))).slice(0, MAX_PHOTOS),
    productIds: Array.from(new Set(input.productIds.filter(Boolean))).slice(0, MAX_PRODUCT_BUTTONS),
    showCatalog: Boolean(input.showCatalog),
  };
}

export function contentProblem(c: BroadcastContent): string | null {
  if (!c.text && c.photoKeys.length === 0) return "Напишите текст или добавьте фото.";
  if (c.text.length > 4000) return "Текст длиннее 4000 символов — Telegram такое не примет.";
  return null;
}

/** Процент выполнения для полосы прогресса в панели. */
export function progressPercent(b: {
  total_count: number;
  sent_count: number;
  failed_count: number;
  blocked_count: number;
}): number {
  if (b.total_count <= 0) return 100;
  const done = b.sent_count + b.failed_count + b.blocked_count;
  return Math.min(100, Math.round((done / b.total_count) * 100));
}
