import { serviceDb } from "@/core/db/client.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { readReceiptText } from "@/core/receipts/verify.server";
import {
  checkInvoiceReceipt,
  claimVerdict,
  operationKey,
  receiptOperationId,
  recipientNames,
} from "./invoice-check";
import type { OpenInvoice } from "./invoices";
import { pageAll } from "@/core/db/page";
import { sha256Hex } from "@/lib/hash";

/**
 * Чек за подписку: распознать (PDF Kaspi — бесплатно из текста, фото —
 * ИИ платформы, не в лимит клиента), сверить со счётом, не принять
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
  // Все отметки, не первые 50: при длинном списке повтор чека иначе пропускался бы молча.
  const rows = await pageAll((from, to) => {
    const q = serviceDb()
      .from("bot_events")
      .select("payload")
      .eq("kind", "payment")
      .eq("payload->>action", "invoice_proof");
    return (op === "eq" ? q.eq(`payload->>${field}`, value) : q.like(`payload->>${field}`, value))
      .order("id", { ascending: true })
      .range(from, to);
  }, "Не удалось проверить повтор чека");
  return rows.map((r) => {
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

/** Несколько открытых счетов, а чек подходит не ровно к одному — сам чек не засчитываем. */
export const SEVERAL_INVOICES = "Несколько открытых счетов — чек проверяет оператор.";

async function receiptText(ctx: TenantContext, file: { bytes: Uint8Array; mime: string }) {
  return readReceiptText(ctx, file.bytes, file.mime || "image/jpeg", { countUsage: false });
}

/**
 * К какому из открытых счетов чек. Один счёт — к нему. Несколько — чек
 * читается один раз и сверяется с каждым; подошёл ровно один — к нему (с
 * прочитанным текстом, второй раз не распознаём). Иначе чек ложится на
 * старейший счёт и ждёт оператора: чек за подписку не должен закрыть счёт
 * пополнения на другую сумму, и наоборот.
 */
export async function pickInvoiceForReceipt(
  ctx: TenantContext,
  invoices: OpenInvoice[],
  file: { bytes: Uint8Array; mime: string },
): Promise<{ invoice: OpenInvoice; text?: string; manual?: string }> {
  const oldest = invoices[0]!;
  if (invoices.length === 1) return { invoice: oldest };
  const recipient = await payoutRecipient();
  if (!recipientNames(recipient).length) return { invoice: oldest, manual: SEVERAL_INVOICES };
  let text: string;
  try {
    text = await receiptText(ctx, file);
  } catch {
    return { invoice: oldest, manual: SEVERAL_INVOICES };
  }
  const fits = invoices.filter(
    (i) =>
      checkInvoiceReceipt(text, {
        amount: i.amount,
        currency: i.currency,
        createdAt: i.created_at,
        recipient,
      }).ok,
  );
  return fits.length === 1
    ? { invoice: fits[0]!, text }
    : { invoice: oldest, manual: SEVERAL_INVOICES };
}

/**
 * Автопроверка чека по счёту. `pre` — итог pickInvoiceForReceipt: готовый
 * текст чека или причина отдать чек оператору (отметка чека пишется всё
 * равно — по ней тот же файл не пройдёт по другому счёту).
 */
export async function verifyInvoiceProof(
  ctx: TenantContext,
  invoice: OpenInvoice,
  file: { bytes: Uint8Array; mime: string },
  pre: { text?: string; manual?: string } = {},
): Promise<InvoiceProofCheck> {
  const hash = sha256Hex(file.bytes);
  const fail = (detail: string, operationId: string | null = null): InvoiceProofCheck => ({
    ok: false,
    hash,
    operationId,
    detail,
  });
  // Без получателя автоматически не принимаем — и не тратим распознавание.
  if (pre.manual) return fail(pre.manual, pre.text ? receiptOperationId(pre.text) : null);
  const recipient = await payoutRecipient();
  if (!recipientNames(recipient).length)
    return fail("Получатель платежей не указан в настройках оператора — чек проверяет оператор.");
  const sameFile = await seenElsewhere("proof_hash", hash, invoice.id);
  if (sameFile) return fail(sameFile);
  let text: string;
  try {
    text = pre.text ?? (await receiptText(ctx, file));
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
