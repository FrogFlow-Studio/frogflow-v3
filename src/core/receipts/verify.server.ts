import { createHash } from "node:crypto";
import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import {
  analyzeReceiptText,
  isPdf,
  looksLikeReceipt,
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
    const p = JSON.parse(raw || "{}") as Partial<OcrUsage>;
    return {
      count: Math.max(0, Number(p.count) || 0),
      month,
      monthCount: p.month === month ? Math.max(0, Number(p.monthCount) || 0) : 0,
    };
  } catch {
    return { count: 0, month, monthCount: 0 };
  }
}

async function recordVisionCall(ctx: TenantContext): Promise<void> {
  const u = parseUsage(await getSetting(ctx, OCR_USAGE_KEY));
  await setSetting(
    ctx,
    OCR_USAGE_KEY,
    JSON.stringify({ ...u, count: u.count + 1, monthCount: u.monthCount + 1 }),
  );
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
    const { text } = await extractText(bytes, { mergePages: true });
    return text.trim();
  } catch {
    return "";
  }
}

export async function readReceiptText(
  ctx: TenantContext,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const pdf = isPdf(mime, bytes);
  if (pdf) {
    const embedded = await embeddedPdfText(bytes);
    if (looksLikeReceipt(embedded) && extractMoneyAmounts(embedded).length >= 1) return embedded;
  }
  const apiKey = env().GOOGLE_VISION_API_KEY?.trim();
  if (!apiKey) throw new Error("GOOGLE_VISION_API_KEY не задан");
  await recordVisionCall(ctx);
  return pdf ? visionPdf(bytes, apiKey) : visionImage(bytes, apiKey);
}

export type VerifyResult = ReceiptAnalysis & { extractedText?: string };

/** Полная проверка: OCR → правила → повтор того же файла по другому заказу. */
export async function verifyReceipt(
  ctx: TenantContext,
  p: {
    bytes: Uint8Array;
    mime: string;
    expectedAmount: number;
    currency?: string;
    orderId: number;
  },
): Promise<VerifyResult> {
  let text: string;
  try {
    text = await readReceiptText(ctx, p.bytes, p.mime || "image/jpeg");
  } catch (e) {
    return {
      ok: false,
      reason: "ocr_unavailable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  const analysis = analyzeReceiptText(text, p.expectedAmount, p.currency);
  const extractedText = text.slice(0, 2000);
  if (!analysis.ok) return { ...analysis, extractedText };
  const hash = createHash("sha256").update(p.bytes).digest("hex");
  const { data: reuse } = await ctx.db
    .from("orders")
    .select("id, display_no, order_no")
    .eq("payment_proof_hash", hash)
    .neq("id", p.orderId)
    .limit(1)
    .maybeSingle();
  if (reuse)
    return {
      ok: false,
      reason: "receipt_reused",
      detail: `Этот же чек уже был принят по заказу №${reuse.display_no ?? reuse.order_no ?? reuse.id}.`,
      extractedText,
    };
  return { ...analysis, extractedText };
}
