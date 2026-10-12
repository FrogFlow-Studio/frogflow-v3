/**
 * Чтение чека моделью (решение Якова 12.10: «зачем Google Vision, Claude
 * понимает фото»). Здесь — чистые правила: запрос, разбор ответа, цена,
 * текст для прежних правил сверки (pure.ts). Вызов модели — reader.server.ts.
 *
 * Модель читает картинку или PDF и отвечает инструментом `receipt`:
 * поля чека, статус платежа, признаки правки и весь текст чека по строкам.
 * Текст идёт в те же правила, что раньше получали текст OCR (сумма, валюта,
 * дата, получатель, номер квитанции) — сверка с заказом не поменялась.
 */
import { receiptOperationId } from "@/core/billing/invoice-check";

/** Самая дешёвая модель, которая читает фото: чек — короткое извлечение. */
export const RECEIPT_AI_MODEL = "claude-haiku-5-5";
/** Claude Haiku 5.5, $ за миллион токенов (запрос до 100K токенов). */
export const RECEIPT_AI_PRICE = { in: 0.1, out: 0.5 };
/**
 * Бронь ИИ-баланса на один чек, $: картинка до ~4 800 токенов, ответ до
 * RECEIPT_AI_MAX_TOKENS — с запасом. Списывается фактическая цена.
 */
export const RECEIPT_AI_RESERVE_USD = 0.003;
export const RECEIPT_AI_MAX_TOKENS = 1500;
export const RECEIPT_AI_TIMEOUT_MS = 25_000;
/** Потолок расхода на чтение чеков в день, $; ключ — RECEIPT_AI_CAP_KEY. */
export const RECEIPT_AI_DAILY_USD = 1;
export const RECEIPT_AI_CAP_KEY = "receipt_ocr_daily_usd";
/** Картинка больше — API её не примет; чек смотрит продавец. */
export const RECEIPT_AI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const RECEIPT_AI_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export type ReceiptStatus = "success" | "failed" | "pending" | "unknown";

/** Что модель прочитала в файле. */
export type ReceiptReading = {
  isReceipt: boolean;
  status: ReceiptStatus;
  amount: number | null;
  currency: string | null;
  datetime: string | null;
  operationId: string | null;
  recipient: string | null;
  bank: string | null;
  /** Явные следы правки или подделки — коротко, по-русски. */
  editSigns: string[];
  /** Весь текст чека по строкам, как напечатан. */
  text: string;
};

export const RECEIPT_SYSTEM = `Ты читаешь файл, который покупатель прислал как чек об оплате заказа (скриншот банковского приложения, фото, PDF). Ответь инструментом receipt.

is_receipt — true, только если это подтверждение платежа или перевода из банка или платёжной системы. Скрин заказа, счёта «к оплате», карточки товара, переписки, реквизитов, баланса без операции — false.

status: success — банк пишет, что платёж выполнен или зачислен; failed — отказ, ошибка, «не прошёл», «недостаточно средств», отмена; pending — «в обработке», «ожидает», «отправлен», но не выполнен; unknown — статуса не видно.

amount — сумма платежа (не комиссия, не остаток, не кэшбэк), числом; currency — код ISO 4217 (KZT, RUB, BYN, KGS, UZS, USD…) по знаку или подписи; datetime — дата и время операции как в чеке; operation_id — номер квитанции, операции, транзакции или чека; recipient — получатель как в чеке (имя, телефон, последние цифры карты или счёта); bank — банк или сервис. Чего нет в файле — null, не придумывай.

edit_signs — только явные признаки, что чек правили или собрали: цифры или строки другим шрифтом, размером или цветом, сдвинутые или наложенные поля, следы затирки, обрезанные края там, где должны быть данные, разная дата в разных местах, сумма прописью не совпадает с цифрами. Обычные сжатие, блики и низкое качество фото признаками не считай. Нет явных — пустой список. Каждый признак — коротко, по-русски.

text — весь текст файла по строкам, как напечатан, без пересказа и без перевода.`;

export const RECEIPT_TOOL = {
  name: "receipt",
  description: "Данные чека об оплате из присланного файла.",
  input_schema: {
    type: "object" as const,
    properties: {
      is_receipt: { type: "boolean" },
      status: { type: "string", enum: ["success", "failed", "pending", "unknown"] },
      amount: { type: ["number", "null"] },
      currency: { type: ["string", "null"] },
      datetime: { type: ["string", "null"] },
      operation_id: { type: ["string", "null"] },
      recipient: { type: ["string", "null"] },
      bank: { type: ["string", "null"] },
      edit_signs: { type: "array", items: { type: "string" } },
      text: { type: "string" },
    },
    required: ["is_receipt", "status", "edit_signs", "text"],
  },
};

const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** Ответ модели → чтение; ответа нет или он не по схеме — null (чек смотрит продавец). */
export function parseReceiptReading(input: unknown): ReceiptReading | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Record<string, unknown>;
  if (typeof v.is_receipt !== "boolean" || typeof v.text !== "string") return null;
  const status = (["success", "failed", "pending", "unknown"] as const).includes(
    v.status as ReceiptStatus,
  )
    ? (v.status as ReceiptStatus)
    : "unknown";
  const amount = typeof v.amount === "number" && Number.isFinite(v.amount) ? v.amount : null;
  const currency = str(v.currency, 8)?.toUpperCase() ?? null;
  return {
    isReceipt: v.is_receipt,
    status,
    amount,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    datetime: str(v.datetime, 60),
    operationId: str(v.operation_id, 60),
    recipient: str(v.recipient),
    bank: str(v.bank, 80),
    editSigns: Array.isArray(v.edit_signs)
      ? v.edit_signs
          .map((s) => str(s, 160))
          .filter((s): s is string => s !== null)
          .slice(0, 5)
      : [],
    text: v.text.trim().slice(0, 8000),
  };
}

/** Цена ответа по usage, $. */
export function receiptCostUsd(usage?: { input_tokens?: number; output_tokens?: number }): number {
  const inp = Math.max(0, usage?.input_tokens ?? 0);
  const out = Math.max(0, usage?.output_tokens ?? 0);
  return Math.round(((inp * RECEIPT_AI_PRICE.in + out * RECEIPT_AI_PRICE.out) / 1e6) * 1e6) / 1e6;
}

/**
 * Текст для правил сверки: текст чека как напечатан. Номер операции, который
 * модель нашла, а правила по тексту не видят (подпись необычная), дописываем
 * строкой «№ квитанции» — по нему ловится тот же перевод другим скриншотом.
 */
export function readingText(r: ReceiptReading): string {
  const lines = [r.text];
  if (r.operationId && !receiptOperationId(r.text)) {
    const id = r.operationId.replace(/\s+/g, " ");
    if ((id.match(/\d/g) ?? []).length >= 6) lines.push(`№ квитанции ${id}`);
  }
  return lines.join("\n").trim();
}

/** Коротко для продавца: что прочитано в чеке. */
export function readingSummary(r: ReceiptReading): string {
  const parts = [
    r.amount != null ? `${r.amount}${r.currency ? ` ${r.currency}` : ""}` : null,
    r.datetime,
    r.operationId ? `№ ${r.operationId}` : null,
    r.recipient ? `получатель ${r.recipient}` : null,
    r.bank,
  ].filter(Boolean);
  return parts.join(", ");
}

/** Тип картинки для API: по байтам, иначе по заявленному; не картинка API — null. */
export function receiptImageType(sniffed: string | null, declared: string): string | null {
  if (sniffed) return RECEIPT_AI_IMAGE_TYPES.includes(sniffed) ? sniffed : null;
  const d = declared.toLowerCase().split(";")[0]!.trim();
  return RECEIPT_AI_IMAGE_TYPES.includes(d) ? d : "image/jpeg";
}
