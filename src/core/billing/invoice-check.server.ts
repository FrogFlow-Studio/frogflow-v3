import { createHash } from "node:crypto";
import { serviceDb } from "@/core/db/client.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { readReceiptText } from "@/core/receipts/verify.server";
import { checkInvoiceReceipt } from "./invoice-check";
import type { OpenInvoice } from "./invoices";

/**
 * Чек за подписку: распознать (PDF Kaspi — бесплатно из текста, фото —
 * Vision платформы, не в лимит клиента), сверить со счётом, не принять
 * второй раз. Отпечаток каждого присланного чека лежит в bot_events
 * (kind=payment, action=invoice_proof) — схема не меняется.
 */
export const RECIPIENT_KEY = "payout_receipt_recipient";

export type InvoiceProofCheck =
  | { ok: true; hash: string; operationId: string }
  | { ok: false; hash: string; operationId: string | null; detail: string };

/** Как получатель платежей платформы выглядит в чеке Kaspi («Яков В.»); пусто — только ручная проверка. */
export async function payoutRecipient(): Promise<string> {
  const { data } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", RECIPIENT_KEY)
    .maybeSingle();
  return data?.value?.trim() ?? "";
}

/** Этот файл или эта операция уже приходили по другому счёту? null — нет; иначе причина. */
async function seenElsewhere(
  field: "proof_hash" | "receipt_op",
  value: string,
  invoiceId: string,
): Promise<string | null> {
  const { data, error } = await serviceDb()
    .from("bot_events")
    .select("id")
    .eq("kind", "payment")
    .eq("payload->>action", "invoice_proof")
    .eq(`payload->>${field}`, value)
    .neq("payload->>invoice_id", invoiceId)
    .limit(1);
  if (error) return `Не удалось проверить повтор чека: ${error.message}`;
  if (!data?.length) return null;
  return field === "proof_hash"
    ? "Этот же файл чека уже присылали по другому счёту."
    : `Операцию ${value} уже присылали по другому счёту.`;
}

export async function verifyInvoiceProof(
  ctx: TenantContext,
  invoice: OpenInvoice,
  file: { bytes: Uint8Array; mime: string },
): Promise<InvoiceProofCheck> {
  const hash = createHash("sha256").update(file.bytes).digest("hex");
  const fail = (detail: string, operationId: string | null = null): InvoiceProofCheck => ({
    ok: false,
    hash,
    operationId,
    detail,
  });
  // Без получателя автоматически не принимаем — и не тратим распознавание.
  const recipient = await payoutRecipient();
  if (!recipient)
    return fail("Получатель платежей не указан в настройках оператора — чек проверяет оператор.");
  const sameFile = await seenElsewhere("proof_hash", hash, invoice.id);
  if (sameFile) return fail(sameFile);
  let text: string;
  try {
    text = await readReceiptText(ctx, file.bytes, file.mime || "image/jpeg", {
      countUsage: false,
    });
  } catch (e) {
    return fail(`Чек не распознан: ${e instanceof Error ? e.message : String(e)}`);
  }
  const v = checkInvoiceReceipt(text, {
    amount: invoice.amount,
    currency: invoice.currency,
    createdAt: invoice.created_at,
    recipient,
  });
  if (!v.ok) return fail(v.detail, v.operationId);
  const sameOp = await seenElsewhere("receipt_op", v.operationId, invoice.id);
  if (sameOp) return fail(sameOp, v.operationId);
  return { ok: true, hash, operationId: v.operationId };
}
