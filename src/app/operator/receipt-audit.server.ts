/**
 * Аудит чеков одного клиента для панели оператора (перенос из v1
 * src/lib/receipt-audit.server): скачать чек из Storage, прогнать через
 * автопроверку по текущим правилам и сравнить с тем, что уже стоит в
 * заказе. Только чтение: заказы не обновляются, материалы не выдаются,
 * месячный лимит проверок клиента не расходуется. Правила — core/receipts/audit.
 */
import { serviceDb } from "@/core/db/client.server";
import {
  classifyActualHandling,
  compareReceiptAudit,
  OCR_REASON_LABEL,
  ocrWouldFromVerify,
  proofPathCandidates,
  VISION_USD_PER_CALL,
  type OcrFailReason,
  type ReceiptAuditInventory,
  type ReceiptAuditRow,
  type ReceiptAuditScanResult,
  type SeenReceiptHash,
} from "@/core/receipts/audit";
import type { VerifyResult } from "@/core/receipts/verify.server";
import type { TenantContext } from "@/core/tenant/resolve.server";

type OrderProofRow = {
  id: number;
  display_no: number | null;
  order_no: number | null;
  status: string;
  total: number | string | null;
  currency: string | null;
  fulfillment_kind: string | null;
  payment_proof_path: string | null;
  payment_proof_hash: string | null;
  admin_note: string | null;
  created_at: string | null;
};

const ORDER_COLS =
  "id, display_no, order_no, status, total, currency, fulfillment_kind, payment_proof_path, payment_proof_hash, admin_note, created_at";

/** Подряд без файла — быстро, Vision не зовём. Потом один чек с файлом. */
const MAX_MISSING_PER_CALL = 20;

/** Чек — это файл в Storage: путь с папкой. Пусто, NULL и «robokassa» отсеиваются. */
const PROOF_PATH_LIKE = "%/%";

export type AuditDeps = {
  download(path: string): Promise<Uint8Array | null>;
  verify(
    ctx: TenantContext,
    p: {
      bytes: Uint8Array;
      mime: string;
      expectedAmount: number;
      currency?: string;
      orderId: number;
    },
  ): Promise<VerifyResult>;
};

const defaultDeps: AuditDeps = {
  async download(path) {
    const { data, error } = await serviceDb().storage.from("payment-proofs").download(path);
    return error || !data ? null : new Uint8Array(await data.arrayBuffer());
  },
  async verify(ctx, p) {
    const { verifyReceipt } = await import("@/core/receipts/verify.server");
    return verifyReceipt(ctx, { ...p, countUsage: false });
  },
};

async function auditContext(botId: string): Promise<TenantContext> {
  const { requireTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  return tenantContext(await requireTenant({ by: "id", value: botId }));
}

function proofOrders(botId: string) {
  return serviceDb()
    .from("orders")
    .select(ORDER_COLS)
    .eq("bot_id", botId)
    .like("payment_proof_path", PROOF_PATH_LIKE);
}

async function countWithProof(botId: string, beforeId = 0): Promise<number> {
  let q = serviceDb()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId)
    .like("payment_proof_path", PROOF_PATH_LIKE);
  if (beforeId > 0) q = q.lt("id", beforeId);
  const { count, error } = await q;
  if (error) throw new Error(`Не удалось посчитать чеки: ${error.message}`);
  return count ?? 0;
}

export async function receiptAuditInventory(botId: string): Promise<ReceiptAuditInventory> {
  const ctx = await auditContext(botId);
  const { visionConfigured, receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  const withFile = await countWithProof(botId);
  return {
    withFile,
    estimatedUsd: Math.round(withFile * VISION_USD_PER_CALL * 100) / 100,
    visionConfigured: visionConfigured(),
    moduleEnabled: Boolean(ctx.tenant.modules.receipt_ocr),
    autoEnabled: await receiptOcrAutoEnabled(ctx),
  };
}

function displayNoOf(o: OrderProofRow): number | string {
  return o.display_no ?? o.order_no ?? o.id;
}

function baseRow(o: OrderProofRow, expectedAmount: number) {
  return {
    orderId: o.id,
    displayNo: displayNoOf(o),
    adminNo: o.order_no,
    status: o.status,
    createdAt: o.created_at,
    expectedAmount,
    currency: o.currency,
    proofPath: o.payment_proof_path ?? "",
  };
}

function skipRow(
  o: OrderProofRow,
  expectedAmount: number,
  detail: string,
  legacyHash: boolean,
): ReceiptAuditRow {
  return {
    ...baseRow(o, expectedAmount),
    proofHash: null,
    matchedAmount: null,
    ocrReason: "skip",
    extractedPreview: null,
    comparison: compareReceiptAudit({
      actual: classifyActualHandling(o, { legacyHash }),
      ocrWould: "skip",
      reasonLabel: OCR_REASON_LABEL.skip,
      verifyDetail: detail,
      actualStatus: o.status,
    }),
  };
}

function verifiedRow(
  o: OrderProofRow,
  expectedAmount: number,
  result: VerifyResult,
  proofHash: string,
  legacyHash: boolean,
): ReceiptAuditRow {
  const reason: OcrFailReason | "ok" = result.ok ? "ok" : result.reason;
  return {
    ...baseRow(o, expectedAmount),
    proofHash,
    matchedAmount: result.ok ? result.matchedAmount : null,
    ocrReason: reason,
    extractedPreview: result.extractedText ? result.extractedText.slice(0, 400) : null,
    comparison: compareReceiptAudit({
      actual: classifyActualHandling(o, { legacyHash }),
      ocrWould: ocrWouldFromVerify(result),
      reasonLabel: OCR_REASON_LABEL[reason],
      verifyDetail: result.ok
        ? `${OCR_REASON_LABEL.ok} (${result.matchedAmount}${o.currency ? ` ${o.currency}` : ""})`
        : result.detail,
      actualStatus: o.status,
    }),
  };
}

/** Тот же файл уже встретился в этом прогоне на другом заказе — повтор, даже если база его не знает. */
function withSessionReuse(result: VerifyResult, seen: SeenReceiptHash | undefined): VerifyResult {
  if (!seen || !result.ok) return result;
  return {
    ok: false,
    reason: "receipt_reused",
    detail: `Этот же файл уже встретился в этом прогоне на заказе №${seen.displayNo}.`,
    extractedText: result.extractedText,
  };
}

/**
 * С новых заказов к старым. Подряд без файла отдаём пачкой (Vision не
 * зовём); как только файл скачался — одна проверка и выход: Vision бывает
 * медленным, а каждый шаг — отдельный запрос из панели.
 */
export async function scanNextReceipt(
  botId: string,
  params: { afterId?: number; seenHashes?: SeenReceiptHash[] },
  deps: AuditDeps = defaultDeps,
): Promise<ReceiptAuditScanResult> {
  const ctx = await auditContext(botId);
  const { visionConfigured } = await import("@/core/receipts/verify.server");
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const { servedByV2 } = await import("@/core/tenant/directory");
  const { proofHashes } = await import("@/core/orders/proof-hash");
  const { sniffProofMime } = await import("@/core/orders/proof-file");
  // Хеш как след автовыдачи — только у заказов прежней платформы (см. classifyActualHandling).
  const legacyHash = !servedByV2(ctx.tenant);
  let afterId = Math.max(0, Math.floor(Number(params.afterId) || 0));
  const rows: ReceiptAuditRow[] = [];
  const finish = async (remaining?: number): Promise<ReceiptAuditScanResult> => {
    const left = remaining ?? (afterId > 0 ? await countWithProof(botId, afterId) : 0);
    return {
      rows,
      afterId,
      remaining: left,
      done: left === 0,
      visionConfigured: visionConfigured(),
    };
  };

  for (let i = 0; i < MAX_MISSING_PER_CALL; i++) {
    let q = proofOrders(botId).order("id", { ascending: false }).limit(1);
    if (afterId > 0) q = q.lt("id", afterId);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(`Не удалось взять следующий чек: ${error.message}`);
    const order = data as OrderProofRow | null;
    if (!order) return finish(0);
    afterId = order.id;

    const expectedAmount = await amountDueNow(ctx, {
      total: Number(order.total) || 0,
      fulfillment_kind: order.fulfillment_kind || "digital",
    });
    const stored = order.payment_proof_path ?? "";
    let bytes: Uint8Array | null = null;
    for (const candidate of proofPathCandidates(stored, botId)) {
      bytes = await deps.download(candidate);
      if (bytes) break;
    }
    if (!bytes) {
      rows.push(skipRow(order, expectedAmount, `Файла нет в Storage: ${stored}`, legacyHash));
      continue;
    }

    const proofHash = proofHashes(bytes).stored;
    const seen = (params.seenHashes ?? []).find(
      (h) => h.hash === proofHash && h.orderId !== order.id,
    );
    const result = await deps.verify(ctx, {
      bytes,
      mime: sniffProofMime(bytes) ?? "image/jpeg",
      expectedAmount,
      currency: order.currency ?? undefined,
      orderId: order.id,
    });
    rows.push(
      verifiedRow(order, expectedAmount, withSessionReuse(result, seen), proofHash, legacyHash),
    );
    return finish();
  }
  return finish();
}
