import { createHash } from "node:crypto";
import { serviceDb } from "@/core/db/client.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { readReceiptText } from "@/core/receipts/verify.server";
import { checkInvoiceReceipt, claimVerdict, operationKey, recipientNames } from "./invoice-check";
import type { OpenInvoice } from "./invoices";
import { serverFailure } from "@/lib/server-failure";

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

type MarkField = "proof_hash" | "receipt_op_key" | "receipt_op";

async function marksBy(
  field: MarkField,
  value: string,
  op: "eq" | "like",
): Promise<Array<{ invoice_id: string | null }>> {
  const q = serviceDb()
    .from("bot_events")
    .select("payload")
    .eq("kind", "payment")
    .eq("payload->>action", "invoice_proof");
  const { data, error } = await (
    op === "eq" ? q.eq(`payload->>${field}`, value) : q.like(`payload->>${field}`, value)
  ).limit(50);
  if (error) throw serverFailure(`Не удалось проверить повтор чека: ${error.message}`);
  return (data ?? []).map((r) => {
    const p = r.payload as { invoice_id?: unknown } | null;
    return { invoice_id: typeof p?.invoice_id === "string" ? p.invoice_id : null };
  });
}

/**
 * Отметки чеков с этим файлом или этой операцией. Номер ищется по ключу из
 * цифр и, для отметок до появления ключа, по сырому номеру с любой
 * приставкой («QR12345678» оканчивается на ключ; ключ — не меньше 6 цифр).
 * Лишнее совпадение (номер длиннее, но с тем же хвостом) отдаёт чек
 * оператору — это безопасная сторона.
 */
async function proofMarks(
  field: "proof_hash" | "receipt_op_key",
  value: string,
): Promise<Array<{ invoice_id: string | null }>> {
  if (field === "proof_hash") return marksBy("proof_hash", value, "eq");
  const [byKey, legacy] = await Promise.all([
    marksBy("receipt_op_key", value, "eq"),
    marksBy("receipt_op", `%${value}`, "like"),
  ]);
  return [...byKey, ...legacy];
}

const dupText = (field: "proof_hash" | "receipt_op_key", value: string) =>
  field === "proof_hash"
    ? "Этот же файл чека уже присылали по другому счёту."
    : `Операцию ${value} уже присылали по другому счёту.`;

/** Этот файл или эта операция уже приходили по другому счёту? null — нет; иначе причина. */
async function seenElsewhere(
  field: "proof_hash" | "receipt_op_key",
  value: string,
  invoiceId: string,
): Promise<string | null> {
  try {
    const marks = await proofMarks(field, value);
    return marks.some((m) => m.invoice_id !== invoiceId) ? dupText(field, value) : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Вторая проверка после записи отметки чека: засчитать чек можно, только
 * если по этому файлу и по этому номеру операции нет отметок других счетов.
 * Закрывает гонку двух одновременных чеков, которую seenElsewhere не видит.
 * null — чек за этим счётом; иначе причина отдать его оператору.
 */
export async function claimReceipt(
  invoiceId: string,
  check: { hash: string; operationId: string },
): Promise<string | null> {
  const pairs: Array<["proof_hash" | "receipt_op_key", string]> = [
    ["proof_hash", check.hash],
    ["receipt_op_key", operationKey(check.operationId)],
  ];
  for (const [field, value] of pairs) {
    let who: ReturnType<typeof claimVerdict>;
    try {
      who = claimVerdict(await proofMarks(field, value), invoiceId);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    if (who === "other") return dupText(field, check.operationId);
    if (who === "missing") return "Отметка чека не записалась — чек проверяет оператор.";
  }
  return null;
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
  if (!recipientNames(recipient).length)
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
  const sameOp = await seenElsewhere("receipt_op_key", operationKey(v.operationId), invoice.id);
  if (sameOp) return fail(sameOp, v.operationId);
  return { ok: true, hash, operationId: v.operationId };
}
