import { PREVIEW_AI_OFF, previewReadonly } from "@/lib/preview";
import { proofHashes } from "@/core/orders/proof-hash";
import { operationKey, receiptOperationId } from "@/core/billing/invoice-check";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import {
  RECEIPT_CHECKS_PER_DAY,
  RECEIPT_CHECKS_PER_ORDER,
  receiptCheckBlocked,
  receiptChecksKey,
  withReceiptCheck,
} from "./attempts";
import { reportError } from "@/lib/errors";
import { getSettingStrict, updateSettingAtomic } from "@/core/settings/settings";
import { convertForReceipt } from "@/core/pricing/pricing";
import {
  analyzeReceiptText,
  checkReceiptRecipient,
  recipientHintsFromInstructions,
  SAME_CURRENCY_UNDERPAY,
  detectReceiptCurrencies,
  isPdf,
  looksLikeReceipt,
  pdfFromHeader,
  unreadableReceiptImage,
  extractMoneyAmounts,
  receiptBeforeOrder,
  type ReceiptAnalysis,
} from "./pure";
import { sha256Hex } from "@/lib/hash";
import { sniffProofMime } from "@/core/orders/proof-file";
import {
  RECEIPT_AI_CAP_KEY,
  RECEIPT_AI_DAILY_USD,
  RECEIPT_AI_MAX_IMAGE_BYTES,
  RECEIPT_AI_RESERVE_USD,
  parseReceiptReading,
  readingText,
  receiptCostUsd,
  readingSummary,
  receiptImageType,
  type ReceiptReading,
} from "./reader";
import { callReceiptModel, receiptModelConfigured, type ReceiptFile } from "./reader.server";

/**
 * Автопроверка чека — не то же, что модуль receipt_ocr. Модуль значит «тариф
 * покрывает и у платформы есть ключ ИИ», переключатель receipt_ocr_auto —
 * продавец сам решает, проверять ли чеки прямо сейчас (ключ отсутствует → включено).
 * Читает чек модель (reader.ts), сверяют с заказом прежние правила (pure.ts).
 */
export const OCR_AUTO_KEY = "receipt_ocr_auto";
export const OCR_USAGE_KEY = "receipt_ocr_usage";
/**
 * «on» — чек, который совпал с заказом, выдаёт заказ сам. По умолчанию
 * выключено (решение 12.10): совпавший чек уходит продавцу с пометкой
 * «совпал», подтверждает он кнопкой.
 */
export const OCR_DELIVER_KEY = "receipt_ocr_deliver";
const MAX_PDF_BYTES = 7 * 1024 * 1024;

/** Читать чеки есть чем: ключ модели у платформы. */
export function receiptReaderConfigured(): boolean {
  return receiptModelConfigured();
}

export async function receiptOcrAutoEnabled(ctx: TenantContext): Promise<boolean> {
  if (!ctx.tenant.modules.receipt_ocr || !receiptReaderConfigured()) return false;
  // Чек уже принят, покупателя не бросаем: настройку или счётчик не прочитали —
  // авто-проверки нет, чек уходит продавцу на ручную (безопасная сторона); сбой — в Sentry.
  try {
    if ((await getSettingStrict(ctx, OCR_AUTO_KEY)) === "false") return false;
    // Лимит проверок плана на месяц: исчерпан — чек уходит продавцу на ручную проверку.
    return !(await receiptLimitReached(ctx));
  } catch (e) {
    await reportError(e, { where: "receipt.ocr-gate", botId: ctx.tenant.id });
    return false;
  }
}

/** Совпавший чек выдаёт заказ сам (переключатель продавца, по умолчанию нет). */
export async function receiptAutoDeliver(ctx: TenantContext): Promise<boolean> {
  try {
    return (await getSettingStrict(ctx, OCR_DELIVER_KEY))?.trim() === "on";
  } catch (e) {
    await reportError(e, { where: "receipt.deliver-gate", botId: ctx.tenant.id });
    return false;
  }
}

export async function receiptLimitReached(ctx: TenantContext): Promise<boolean> {
  const { tenantLimits } = await import("@/core/plans/tenant");
  const { overLimit } = await import("@/core/plans/plans");
  const limits = tenantLimits(ctx.tenant);
  if (!limits || limits.receiptChecks === null) return false;
  const u = parseUsage(await getSettingStrict(ctx, OCR_USAGE_KEY));
  return overLimit(u.monthCount, limits.receiptChecks);
}

export type OcrUsage = { count: number; month: string; monthCount: number };

export function parseUsage(
  raw: string | null | undefined,
  month = new Date().toISOString().slice(0, 7),
): OcrUsage {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    // v1 хранила в этом ключе голое число — счётчик за всё время, без месяца.
    const p: Partial<OcrUsage> =
      typeof parsed === "number" ? { count: parsed } : ((parsed ?? {}) as Partial<OcrUsage>);
    return {
      count: Math.max(0, Number(p.count) || 0),
      month,
      monthCount: p.month === month ? Math.max(0, Number(p.monthCount) || 0) : 0,
    };
  } catch {
    return { count: 0, month, monthCount: 0 };
  }
}

/** Прибавка атомарная: альбом из нескольких фото не теряет вызовы в месячном счётчике. */
async function recordReceiptCall(ctx: TenantContext): Promise<void> {
  await updateSettingAtomic(ctx, OCR_USAGE_KEY, (raw) => {
    const u = parseUsage(raw);
    return JSON.stringify({ ...u, count: u.count + 1, monthCount: u.monthCount + 1 });
  });
}

/**
 * Потолок дня на чтение чеков, $: расход берём из того же учёта ИИ-баланса
 * (`ai_charges:<день>`, вид receipt_ocr). Не прочитали — считаем потолок
 * достигнутым: чек смотрит продавец.
 */
async function receiptDailyCapReached(ctx: TenantContext): Promise<boolean> {
  const { AI_CHARGES_PREFIX } = await import("@/core/ai/balance");
  const { parseCharges } = await import("@/core/ai/pure");
  const date = new Date().toISOString().slice(0, 10);
  const capRaw = Number((await getSettingStrict(ctx, RECEIPT_AI_CAP_KEY))?.trim());
  const cap = Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : RECEIPT_AI_DAILY_USD;
  const spent = parseCharges(await getSettingStrict(ctx, `${AI_CHARGES_PREFIX}${date}`), date).uses
    .receipt_ocr?.usd;
  return (spent ?? 0) >= cap;
}

/** Текст, уже лежащий в PDF (Kaspi — вектор, не скан): бесплатно и точнее модели. */
async function embeddedPdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText } = await import("unpdf");
    // Копия: pdf.js забирает (detach) буфер, а байты нужны дальше — модели и отпечатку чека.
    const { text } = await extractText(bytes.slice(), { mergePages: true });
    return text.trim();
  } catch {
    return "";
  }
}

/** Прочитанный чек: текст для правил и, если читала модель, её разбор. */
export type ReceiptRead = { text: string; reading: ReceiptReading | null };

export async function readReceipt(
  ctx: TenantContext,
  bytes: Uint8Array,
  mime: string,
  /** Чек за подписку платформе — не проверка клиента, в его лимит не идёт. */
  opts: { countUsage?: boolean } = {},
): Promise<ReceiptRead> {
  const pdf = isPdf(mime, bytes);
  // Без вызова и без списания лимита: такой файл модель не примет.
  if (!pdf && unreadableReceiptImage(bytes))
    throw new Error("Фото в формате HEIC/AVIF автопроверка не читает — чек посмотрит продавец");
  let file: ReceiptFile;
  if (pdf) {
    bytes = pdfFromHeader(bytes);
    const embedded = await embeddedPdfText(bytes);
    if (looksLikeReceipt(embedded) && extractMoneyAmounts(embedded).length >= 1)
      return { text: embedded, reading: null };
    if (bytes.length > MAX_PDF_BYTES) throw new Error("PDF слишком большой для автопроверки");
    file = { kind: "pdf", base64: Buffer.from(bytes).toString("base64") };
  } else {
    const mediaType = receiptImageType(sniffProofMime(bytes), mime);
    if (!mediaType) throw new Error("Формат файла автопроверка не читает — чек посмотрит продавец");
    if (bytes.length > RECEIPT_AI_MAX_IMAGE_BYTES)
      throw new Error("Фото больше 5 МБ — чек посмотрит продавец");
    file = { kind: "image", mediaType, base64: Buffer.from(bytes).toString("base64") };
  }
  if (previewReadonly()) throw new Error(PREVIEW_AI_OFF);
  if (!receiptReaderConfigured()) throw new Error("ИИ-ключ платформы не задан");
  const read = async (): Promise<{ r: ReceiptRead; usd: number }> => {
    const answer = await callReceiptModel(file);
    const reading = parseReceiptReading(answer.input);
    if (!reading) throw new Error("ИИ не вернул разбор чека — чек посмотрит продавец");
    return { r: { text: readingText(reading), reading }, usd: receiptCostUsd(answer.usage) };
  };
  // Чек за подписку платформе — не за счёт клиента: ни лимита, ни ИИ-баланса.
  if (opts.countUsage === false) return (await read()).r;
  if (await receiptDailyCapReached(ctx))
    throw new Error("Дневной потолок расхода на чтение чеков исчерпан — чек посмотрит продавец");
  // ИИ-баланс клиента (core/ai/balance): кончился — чек посмотрит продавец.
  const { aiReserve, aiSettle, aiRelease } = await import("@/core/ai/balance");
  const hold = await aiReserve(ctx, "receipt_ocr", RECEIPT_AI_RESERVE_USD);
  if (hold === "short") throw new Error("ИИ-баланс магазина закончился — чек посмотрит продавец");
  if (hold === "failed") throw new Error("Сбой учёта ИИ-баланса — чек посмотрит продавец");
  await recordReceiptCall(ctx);
  let done: { r: ReceiptRead; usd: number };
  try {
    done = await read();
  } catch (e) {
    await aiRelease(ctx, hold);
    throw e;
  }
  await aiSettle(ctx, hold, done.usd);
  return done.r;
}

/** Только текст чека — для сверки счёта подписки (core/billing). */
export async function readReceiptText(
  ctx: TenantContext,
  bytes: Uint8Array,
  mime: string,
  opts: { countUsage?: boolean } = {},
): Promise<string> {
  return (await readReceipt(ctx, bytes, mime, opts)).text;
}

export type VerifyResult = ReceiptAnalysis & {
  extractedText?: string;
  /** Разбор модели (сумма, дата, номер, получатель) — продавцу в уведомление. */
  reading?: ReceiptReading | null;
};

/**
 * Чек только в чужой валюте (покупатель платил рублями за заказ в тенге):
 * переводим сумму заказа по курсу в валюту чека и сверяем с тем же допуском
 * ±30% — он покрывает спред банка, как в v1. Курса нет — остаётся
 * currency_mismatch, чек смотрит продавец.
 */
async function withFx(
  analysis: ReceiptAnalysis,
  text: string,
  p: { expectedAmount: number; currency?: string },
): Promise<ReceiptAnalysis> {
  if (analysis.ok || analysis.reason !== "currency_mismatch") return analysis;
  const cur = p.currency?.trim().toUpperCase();
  if (!cur) return analysis;
  const misses: string[] = [];
  for (const foreign of detectReceiptCurrencies(text).filter((c) => c !== cur)) {
    const converted = await convertForReceipt(p.expectedAmount, cur, foreign);
    if (converted == null || converted <= 0) continue;
    const r = analyzeReceiptText(text, converted, foreign);
    if (r.ok) return { ...r, matchedCurrency: foreign };
    misses.push(`${converted} ${foreign}`);
  }
  if (misses.length === 0) return analysis;
  return {
    ok: false,
    reason: "amount_mismatch",
    detail: `Заказ ${p.expectedAmount} ${cur} по курсу — ${misses.join(" / ")}; такой суммы в чеке нет (допуск ±30%).`,
  };
}

/** Отметка «этот номер квитанции уже принят»: receipt_no:<sha256 цифр номера> → id заказа. */
export const RECEIPT_NO_PREFIX = "receipt_no:";

/** Полная проверка: OCR → правила → повтор того же файла по другому заказу. */
export async function verifyReceipt(
  ctx: TenantContext,
  p: {
    bytes: Uint8Array;
    mime: string;
    expectedAmount: number;
    currency?: string;
    orderId: number;
    /** Аудит чеков оператора — не проверка клиента, в его лимит не идёт. */
    countUsage?: boolean;
    /** Время проверки: задано — устаревший чек (`receipt_stale`) идёт продавцу; аудит не задаёт. */
    now?: Date;
    /** Страна способа оплаты заказа: задана — получатель в чеке сверяется с реквизитами продавца. */
    recipientCountry?: string | null;
    /** Когда создан заказ: чек, выписанный раньше, — подозрительный. */
    orderCreatedAt?: string | null;
  },
): Promise<VerifyResult> {
  let read: ReceiptRead;
  try {
    read = await readReceipt(ctx, p.bytes, p.mime || "image/jpeg", {
      countUsage: p.countUsage,
    });
  } catch (e) {
    return {
      ok: false,
      reason: "ocr_unavailable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  const { text, reading } = read;
  const extractedText = text.slice(0, 2000);
  const base = { extractedText, reading };
  // Что модель поняла по картинке, важнее слов-маркеров: «не чек» и «платёж
  // не прошёл» — покупателя просим прислать чек успешной оплаты.
  if (reading && !reading.isReceipt)
    return {
      ok: false,
      reason: "not_receipt",
      detail: "ИИ: в файле нет подтверждения платежа (не чек банка).",
      ...base,
    };
  if (reading?.status === "failed")
    return {
      ok: false,
      reason: "payment_failed",
      detail: "ИИ: на скриншоте банк пишет, что платёж не прошёл.",
      ...base,
    };
  // Своя валюта — без недоплаты; чужая (withFx) — прежний допуск по курсу.
  const analyze = (t: string) =>
    withFx(
      analyzeReceiptText(t, p.expectedAmount, p.currency, {
        underpay: SAME_CURRENCY_UNDERPAY,
        now: p.now,
      }),
      t,
      p,
    );
  let analysis = await analyze(text);
  // Модель видит чек, а в тексте нет привычных слов («оплата», «перевод»):
  // сверяем сумму, которую прочитала модель, теми же правилами.
  if (!analysis.ok && analysis.reason === "not_receipt" && reading?.amount != null) {
    const labeled = `${text}\nСумма: ${reading.amount} ${reading.currency ?? ""}\nПлатёж выполнен`;
    analysis = await analyze(labeled);
    if (!analysis.ok && analysis.reason === "not_receipt")
      analysis = {
        ok: false,
        reason: "amount_mismatch",
        detail: "ИИ видит чек, но сверить его с заказом не удалось — проверьте вручную.",
      };
  }
  if (!analysis.ok) return { ...analysis, ...base };
  if (p.recipientCountry) {
    // Получатель в чеке против реквизитов способа оплаты, которым платил покупатель.
    const { data: method, error: methodError } = await ctx.db
      .from("payment_methods")
      .select("instructions")
      .eq("country_code", p.recipientCountry)
      .eq("is_active", true)
      .order("sort_order")
      .order("id")
      .limit(1)
      .maybeSingle();
    if (methodError)
      return {
        ok: false,
        reason: "ocr_unavailable",
        detail: "Не удалось прочитать реквизиты способа оплаты — чек посмотрит продавец.",
        ...base,
      };
    const hints = recipientHintsFromInstructions(method?.instructions ?? "");
    if (checkReceiptRecipient(text, hints) === "mismatch")
      return {
        ok: false,
        reason: "recipient_mismatch",
        detail: "Получатель в чеке не совпадает с реквизитами способа оплаты — проверьте вручную.",
        ...base,
      };
  }
  const { data: reuse, error: reuseError } = await ctx.db
    .from("orders")
    .select("id, display_no, order_no")
    .in("payment_proof_hash", proofHashes(p.bytes).all)
    .neq("id", p.orderId)
    .limit(1)
    .maybeSingle();
  // Не прочиталось — не «повтора нет»: чек уходит продавцу, как и при сбое сверки с VIP.
  if (reuseError)
    return {
      ok: false,
      reason: "receipt_reused",
      detail: "Не удалось сверить чек с прежними заказами — чек посмотрит продавец.",
      ...base,
    };
  if (reuse)
    return {
      ok: false,
      reason: "receipt_reused",
      detail: `Этот же чек уже был принят по заказу №${reuse.display_no ?? reuse.order_no ?? reuse.id}.`,
      ...base,
    };
  // Чек заказа, уже присланный за VIP-подписку (core/vip/auto-check). У VIP
  // номер «заказа» отрицательный — свои отпечатки он сверяет сам.
  if (p.orderId > 0) {
    const { VIP_PROOF_PREFIX } = await import("@/core/vip/auto-check");
    const { data: vip, error: vipError } = await ctx.db
      .from("app_settings")
      .select("key")
      .in(
        "key",
        proofHashes(p.bytes).all.map((h) => `${VIP_PROOF_PREFIX}${h}`),
      )
      .limit(1);
    if (vipError || vip?.length)
      return {
        ok: false,
        reason: "receipt_reused",
        detail: vipError
          ? "Не удалось сверить чек с заявками VIP."
          : "Этот же чек уже был прислан за VIP-подписку.",
        ...base,
      };
  }
  // Тот же перевод новым скриншотом: файл другой, номер квитанции тот же.
  // Аудит чеков оператора (countUsage: false) отметок не оставляет.
  if (p.orderId > 0 && p.countUsage !== false) {
    const taken = await claimReceiptNumber(ctx, p.orderId, text);
    if (taken) return { ok: false, reason: "receipt_reused", detail: taken, ...base };
  }
  // Сумма сошлась и повтора нет — остались признаки подделки без банка.
  const doubts = receiptDoubts(text, reading, p.orderCreatedAt);
  if (doubts.length)
    return {
      ok: false,
      reason: "receipt_suspicious",
      detail: `Сумма сошлась, но чек подозрительный: ${doubts.join("; ")}.`,
      ...base,
    };
  return { ...analysis, ...base };
}

/** Признаки, по которым совпавший чек всё же смотрит продавец. */
export function receiptDoubts(
  text: string,
  reading: ReceiptReading | null,
  orderCreatedAt?: string | null,
): string[] {
  const out: string[] = [];
  if (reading?.status === "pending") out.push("платёж в обработке, не выполнен");
  if (reading?.editSigns.length) out.push(...reading.editSigns.map((s) => `ИИ: ${s}`));
  if (orderCreatedAt && receiptBeforeOrder(text, orderCreatedAt))
    out.push("дата в чеке раньше создания заказа");
  return out;
}

/** Ключ отметки номера квитанции в app_settings: хэш цифр номера, сам номер не храним. */
export function receiptNoKey(operationId: string): string {
  const digits = operationKey(operationId);
  return `${RECEIPT_NO_PREFIX}${sha256Hex(digits)}`;
}

/**
 * Занять номер квитанции из чека за заказом: условная запись (уникальность
 * bot_id+key) — из двух одновременных заказов номер достанется одному.
 * null — номер свободен или его уже занял этот же заказ (повторный чек по
 * нему же); иначе причина отдать чек продавцу. Номера в чеке нет — повтор
 * ловит только отпечаток файла.
 */
export async function claimReceiptNumber(
  ctx: TenantContext,
  orderId: number,
  text: string,
): Promise<string | null> {
  const operationId = receiptOperationId(text);
  if (!operationId) return null;
  const key = receiptNoKey(operationId);
  const { error } = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key,
    value: String(orderId),
    updated_at: new Date().toISOString(),
  });
  if (!error) return null;
  if (error.code !== "23505") return "Не удалось сверить номер квитанции — чек посмотрит продавец.";
  const { data: row, error: readError } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("bot_id", ctx.tenant.id)
    .eq("key", key)
    .maybeSingle();
  if (readError || !row) return "Не удалось сверить номер квитанции — чек посмотрит продавец.";
  if (String(row.value) === String(orderId)) return null;
  const { data: other, error: orderError } = await ctx.db
    .from("orders")
    .select("display_no, order_no, id")
    .eq("id", Number(row.value))
    .maybeSingle();
  // Не прочитали заказ — причина та же, только без номера: чек всё равно уходит продавцу.
  if (orderError)
    return `Квитанция №${operationId} уже принята по другому заказу — возможно, тот же перевод.`;
  const shown = other ? (other.display_no ?? other.order_no ?? other.id) : row.value;
  return `Квитанция №${operationId} уже принята по заказу №${shown} — возможно, тот же перевод.`;
}

/**
 * Проверка чека покупателя с его лимитом: сверх лимита модель не зовём, чек
 * уходит продавцу. Попытка записывается до вызова одной атомарной записью
 * (сравнение и замена): альбом из десяти фото — десять параллельных
 * обработчиков — не проскочит мимо счётчика.
 */
export async function verifyCustomerReceipt(
  ctx: TenantContext,
  customer: Customer,
  p: Parameters<typeof verifyReceipt>[1] & {
    /** false — вызывающий сверяет дату сам (VIP: чек не старше заявки). По умолчанию чек старше 3 суток идёт продавцу. */
    ageCheck?: boolean;
  },
  now = new Date(),
): Promise<{ result: VerifyResult; customer: Customer }> {
  let blocked: "order" | "day" | null = null;
  const written = await updateSettingAtomic(ctx, receiptChecksKey(customer.userKey), (raw) => {
    blocked = receiptCheckBlocked(raw, p.orderId, now);
    return blocked ? null : withReceiptCheck(raw, p.orderId, now);
  });
  if (written === "failed")
    return {
      customer,
      result: {
        ok: false,
        reason: "ocr_unavailable",
        detail: "Счётчик автопроверок не записался — чек посмотрит продавец.",
      },
    };
  if (written === "skipped")
    return {
      customer,
      result: {
        ok: false,
        reason: "check_limit",
        detail:
          blocked === "order"
            ? `Покупатель прислал уже ${RECEIPT_CHECKS_PER_ORDER} файла по этому заказу — автопроверка остановлена.`
            : `Покупатель исчерпал ${RECEIPT_CHECKS_PER_DAY} автопроверок чека за сутки.`,
      },
    };
  return {
    customer,
    result: await verifyReceipt(ctx, {
      ...p,
      now: p.ageCheck === false ? undefined : (p.now ?? now),
    }),
  };
}

/**
 * Итог проверки для продавца — в заметку заказа и уведомление. Совпавший чек
 * банк не подтверждал: «совпал» значит сумма, получатель и даты сошлись и
 * повтора нет; деньги продавец смотрит у себя в банке.
 */
export function sellerReceiptNote(v: VerifyResult): string {
  const seen = v.reading ? readingSummary(v.reading) : "";
  if (v.ok)
    return `✅ Чек совпал с заказом${seen ? `: ${seen}` : `: сумма ${v.matchedAmount}`}. Повтора нет. Проверьте поступление в банке и подтвердите заказ.`;
  return `${v.detail}${seen ? ` Прочитано: ${seen}.` : ""}`;
}
