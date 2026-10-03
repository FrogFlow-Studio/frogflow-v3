import { PREVIEW_AI_OFF, previewReadonly } from "@/lib/preview";
import { env } from "@/config/env";
import { proofHashes } from "@/core/orders/proof-hash";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import {
  RECEIPT_CHECKS_PER_DAY,
  RECEIPT_CHECKS_PER_ORDER,
  receiptCheckBlocked,
  receiptChecksKey,
  withReceiptCheck,
} from "./attempts";
import { getSetting, updateSettingAtomic } from "@/core/settings/settings";
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
  visionUnreadableImage,
  extractMoneyAmounts,
  type ReceiptAnalysis,
} from "./pure";

/**
 * Автопроверка чека — не то же, что модуль receipt_ocr. Модуль значит «тариф
 * покрывает и у платформы есть Vision», переключатель receipt_ocr_auto —
 * продавец сам решает, гонять ли OCR прямо сейчас (ключ отсутствует → включено).
 */
export const OCR_AUTO_KEY = "receipt_ocr_auto";
export const OCR_USAGE_KEY = "receipt_ocr_usage";
const MAX_PDF_BYTES = 7 * 1024 * 1024;

export function visionConfigured(): boolean {
  return Boolean(env().GOOGLE_VISION_API_KEY?.trim());
}

export async function receiptOcrAutoEnabled(ctx: TenantContext): Promise<boolean> {
  if (!ctx.tenant.modules.receipt_ocr || !visionConfigured()) return false;
  if ((await getSetting(ctx, OCR_AUTO_KEY)) === "false") return false;
  // Лимит проверок плана на месяц: исчерпан — чек уходит продавцу на ручную проверку.
  return !(await receiptLimitReached(ctx));
}

export async function receiptLimitReached(ctx: TenantContext): Promise<boolean> {
  const { tenantLimits } = await import("@/core/plans/tenant");
  const { overLimit } = await import("@/core/plans/plans");
  const limits = tenantLimits(ctx.tenant);
  if (!limits || limits.receiptChecks === null) return false;
  const u = parseUsage(await getSetting(ctx, OCR_USAGE_KEY));
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
async function recordVisionCall(ctx: TenantContext): Promise<void> {
  await updateSettingAtomic(ctx, OCR_USAGE_KEY, (raw) => {
    const u = parseUsage(raw);
    return JSON.stringify({ ...u, count: u.count + 1, monthCount: u.monthCount + 1 });
  });
}

type VisionPage = {
  error?: { message?: string };
  fullTextAnnotation?: { text?: string };
  textAnnotations?: Array<{ description?: string }>;
};
const pageText = (p: VisionPage | undefined) =>
  p?.fullTextAnnotation?.text?.trim() || p?.textAnnotations?.[0]?.description?.trim() || "";

async function visionImage(bytes: Uint8Array, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        requests: [
          {
            image: { content: Buffer.from(bytes).toString("base64") },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          },
        ],
      }),
    },
  );
  const json = (await res.json()) as { error?: { message?: string }; responses?: VisionPage[] };
  if (!res.ok) throw new Error(json.error?.message || `Vision HTTP ${res.status}`);
  const first = json.responses?.[0];
  if (first?.error?.message) throw new Error(first.error.message);
  return pageText(first);
}

/** PDF — files:annotate (до 5 страниц синхронно). Банковский чек из РФ/РБ часто PDF. */
async function visionPdf(bytes: Uint8Array, apiKey: string): Promise<string> {
  if (bytes.length > MAX_PDF_BYTES) throw new Error("PDF слишком большой для онлайн-OCR");
  const res = await fetch(
    `https://vision.googleapis.com/v1/files:annotate?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        requests: [
          {
            inputConfig: {
              content: Buffer.from(bytes).toString("base64"),
              mimeType: "application/pdf",
            },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            pages: [1, 2, 3, 4, 5],
          },
        ],
      }),
    },
  );
  const json = (await res.json()) as {
    error?: { message?: string };
    responses?: Array<{ error?: { message?: string }; responses?: VisionPage[] }>;
  };
  if (!res.ok) throw new Error(json.error?.message || `Vision HTTP ${res.status}`);
  const file = json.responses?.[0];
  if (file?.error?.message) throw new Error(file.error.message);
  return (file?.responses ?? []).map(pageText).filter(Boolean).join("\n");
}

/** Текст, уже лежащий в PDF (Kaspi — вектор, не скан): бесплатно и точнее Vision. */
async function embeddedPdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText } = await import("unpdf");
    // Копия: pdf.js забирает (detach) буфер, а байты нужны дальше — Vision и отпечаток чека.
    const { text } = await extractText(bytes.slice(), { mergePages: true });
    return text.trim();
  } catch {
    return "";
  }
}

export async function readReceiptText(
  ctx: TenantContext,
  bytes: Uint8Array,
  mime: string,
  /** Чек за подписку платформе — не проверка клиента, в его лимит не идёт. */
  opts: { countUsage?: boolean } = {},
): Promise<string> {
  const pdf = isPdf(mime, bytes);
  // Без вызова и без списания лимита: ответ Vision всё равно был бы ошибкой.
  if (!pdf && visionUnreadableImage(bytes))
    throw new Error("Фото в формате HEIC/AVIF автопроверка не читает — чек посмотрит продавец");
  if (pdf) {
    bytes = pdfFromHeader(bytes);
    const embedded = await embeddedPdfText(bytes);
    if (looksLikeReceipt(embedded) && extractMoneyAmounts(embedded).length >= 1) return embedded;
  }
  if (previewReadonly()) throw new Error(PREVIEW_AI_OFF);
  const apiKey = env().GOOGLE_VISION_API_KEY?.trim();
  if (!apiKey) throw new Error("GOOGLE_VISION_API_KEY не задан");
  const read = () => (pdf ? visionPdf(bytes, apiKey) : visionImage(bytes, apiKey));
  // Чек за подписку платформе — не за счёт клиента: ни лимита, ни ИИ-баланса.
  if (opts.countUsage === false) return read();
  // ИИ-баланс клиента (core/ai/balance): кончился — чек посмотрит продавец.
  const { aiReserve, aiSettle, aiRelease } = await import("@/core/ai/balance");
  const { VISION_USD_PER_CALL } = await import("./audit");
  const hold = await aiReserve(ctx, "receipt_ocr", VISION_USD_PER_CALL);
  if (hold === "short") throw new Error("ИИ-баланс магазина закончился — чек посмотрит продавец");
  if (hold === "failed") throw new Error("Сбой учёта ИИ-баланса — чек посмотрит продавец");
  await recordVisionCall(ctx);
  let text: string;
  try {
    text = await read();
  } catch (e) {
    await aiRelease(ctx, hold);
    throw e;
  }
  await aiSettle(ctx, hold, VISION_USD_PER_CALL);
  return text;
}

export type VerifyResult = ReceiptAnalysis & { extractedText?: string };

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
  },
): Promise<VerifyResult> {
  let text: string;
  try {
    text = await readReceiptText(ctx, p.bytes, p.mime || "image/jpeg", {
      countUsage: p.countUsage,
    });
  } catch (e) {
    return {
      ok: false,
      reason: "ocr_unavailable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  // Своя валюта — без недоплаты; чужая (withFx) — прежний допуск по курсу.
  const analysis = await withFx(
    analyzeReceiptText(text, p.expectedAmount, p.currency, {
      underpay: SAME_CURRENCY_UNDERPAY,
      now: p.now,
    }),
    text,
    p,
  );
  const extractedText = text.slice(0, 2000);
  if (!analysis.ok) return { ...analysis, extractedText };
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
        extractedText,
      };
    const hints = recipientHintsFromInstructions(method?.instructions ?? "");
    if (checkReceiptRecipient(text, hints) === "mismatch")
      return {
        ok: false,
        reason: "recipient_mismatch",
        detail: "Получатель в чеке не совпадает с реквизитами способа оплаты — проверьте вручную.",
        extractedText,
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
      extractedText,
    };
  if (reuse)
    return {
      ok: false,
      reason: "receipt_reused",
      detail: `Этот же чек уже был принят по заказу №${reuse.display_no ?? reuse.order_no ?? reuse.id}.`,
      extractedText,
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
        extractedText,
      };
  }
  return { ...analysis, extractedText };
}

/**
 * Проверка чека покупателя с его лимитом: сверх лимита Vision не зовём, чек
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
