import { validateProofFile } from "./proof-file";
import { proofHashes } from "./proof-hash";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { recordOrderEvent } from "./events";
import { serviceDb } from "@/core/db/client.server";
import { canResendMaterials } from "./pure";
import { serverFailure } from "@/lib/server-failure";
import { type OrderRow, type OrderWithItems, PROOF_STATUSES } from "./order-model";
import { getOrder } from "./order-queries";

/** Чек об оплате: приём, подтверждение, повторная отправка. */

export type ProofFile = { bytes: Uint8Array; mime: string; ext: string };

export type AttachProofResult =
  | { ok: true; order: OrderWithItems; hash: string }
  | {
      ok: false;
      reason:
        "not_found" | "closed" | "duplicate" | "upload_failed" | "invalid_file" | "file_too_large";
    };

/**
 * Чек оплаты: в бакет payment-proofs под префиксом bot_id (изоляция
 * хранилища — префиксом пути, не RLS), хеш против повторной отправки того
 * же чека, статус awaiting_confirmation.
 */
export async function attachPaymentProof(
  ctx: TenantContext,
  orderId: number,
  file: ProofFile,
): Promise<AttachProofResult> {
  const order = await getOrder(ctx, orderId);
  if (!order) return { ok: false, reason: "not_found" };
  if (!(PROOF_STATUSES as readonly string[]).includes(order.status))
    return { ok: false, reason: "closed" };
  // Только картинка или PDF до 20 МБ; тип и расширение — по содержимому.
  const checked = validateProofFile(file);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  file = { bytes: file.bytes, mime: checked.mime, ext: checked.ext };

  // Отпечаток содержимого, а не сырых байтов; старые чеки — и по сырому (proof-hash).
  const hashes = proofHashes(file.bytes);
  const hash = hashes.stored;
  const { data: dup, error: dupError } = await ctx.db
    .from("orders")
    .select("id")
    .in("payment_proof_hash", hashes.all)
    .neq("id", orderId)
    .limit(1)
    .maybeSingle();
  // Не прочиталось — не «дубля нет»: чужой чек не должен пройти из-за сбоя.
  if (dupError)
    throw serverFailure(`Чек заказа #${orderId} не сверен с прежними: ${dupError.message}`);
  if (dup) return { ok: false, reason: "duplicate" };

  const key = `${ctx.tenant.id}/order-${orderId}/${Date.now()}.${file.ext}`;
  const body = new Blob([file.bytes as BlobPart], {
    type: file.mime || "application/octet-stream",
  });
  const up = await serviceDb()
    .storage.from("payment-proofs")
    .upload(key, body, { contentType: file.mime, upsert: true });
  if (up.error) {
    console.error("[orders] proof upload failed", up.error);
    return { ok: false, reason: "upload_failed" };
  }
  // Пока грузился файл, заказ могли забрать на выдачу (продавец или
  // автопроверка прошлого чека). Статус пишем, только если заказ всё ещё
  // ждёт оплаты: иначе «ждёт подтверждения» поверх «выдаётся» открыло бы
  // его снова, и этот чек запустил бы вторую выдачу.
  const { data: updated, error } = await ctx.db
    .from("orders")
    .update({ payment_proof_path: key, payment_proof_hash: hash, status: "awaiting_confirmation" })
    .eq("id", orderId)
    .in("status", [...PROOF_STATUSES])
    .select("*, order_items(*)")
    .maybeSingle();
  if (error) throw serverFailure(error.message);
  if (!updated) {
    await serviceDb().storage.from("payment-proofs").remove([key]);
    return { ok: false, reason: "closed" };
  }
  await recordOrderEvent(ctx, orderId, "proof", { path: key });
  return { ok: true, order: updated as OrderWithItems, hash };
}

/**
 * Автопроверка одобрила чек с отпечатком `hash`: заказ становится
 * «оплачен», только если у него всё ещё этот чек. Пока шла проверка,
 * покупатель мог прислать другой файл — он перезаписал отпечаток, и
 * одобренный чек больше ни к чему не привязан: его можно было бы принести
 * к следующему заказу. Тогда false, и заказ идёт продавцу. «Оплачен»
 * закрывает приём чеков (PROOF_STATUSES), так что после этой записи
 * отпечаток уже не сменится.
 */
export async function markProofVerified(
  ctx: TenantContext,
  orderId: number,
  hash: string,
  note: string,
  /**
   * Сумма, найденная в чеке. `currency` — только если чек в другой валюте, чем
   * заказ (принят по курсу): тогда в журнал идёт сумма чека в его валюте, а
   * оплаченным считается весь заказ.
   */
  receipt?: { amount: number; currency?: string },
): Promise<boolean> {
  const { data: before, error: readError } = receipt
    ? await ctx.db
        .from("orders")
        .select("total, currency, paid_amount")
        .eq("id", orderId)
        .maybeSingle()
    : { data: null, error: null };
  if (readError) throw serverFailure(`markProofVerified: заказ #${orderId}: ${readError.message}`);
  const total = Number(before?.total ?? 0);
  const foreign = Boolean(receipt?.currency);
  const paidNow = receipt
    ? foreign
      ? total
      : Math.min(total, Number(before?.paid_amount ?? 0) + receipt.amount)
    : null;
  const { data, error } = await ctx.db
    .from("orders")
    .update({
      status: "paid",
      admin_note: note.slice(0, 500),
      ...(paidNow != null ? { paid_amount: paidNow } : {}),
    })
    .eq("id", orderId)
    .eq("status", "awaiting_confirmation")
    .eq("payment_proof_hash", hash)
    .select("id");
  if (error) throw serverFailure(`markProofVerified: заказ #${orderId}: ${error.message}`);
  const ok = Boolean(data?.length);
  // Чек настоящий, но заказ успели отменить или отклонить: деньги пришли по
  // закрытому заказу. В оплату не пишем, но событие с суммой и номером чека
  // (хешем файла) остаётся в истории: продавец видит, что покупатель заплатил.
  if (!ok && receipt && before) {
    const { data: now, error: nowError } = await ctx.db
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .maybeSingle();
    if (nowError) throw serverFailure(`markProofVerified: заказ #${orderId}: ${nowError.message}`);
    if (now && ["cancelled", "rejected", "refunded"].includes(now.status)) {
      const { recordUnappliedPayment } = await import("@/core/payments/payment");
      await recordUnappliedPayment(ctx, orderId, "payment_on_closed", {
        amount: receipt.amount,
        currency: receipt.currency ?? before.currency,
        provider: "receipt",
        ref: hash,
        status: now.status,
      });
    }
  }
  if (ok && receipt && before) {
    // Платёж в журнал: из него собирается выгрузка «Оплаты». Переплата — отдельным полем.
    const over = foreign
      ? 0
      : Math.round((Number(before.paid_amount ?? 0) + receipt.amount - total) * 100) / 100;
    const { recordOrderEvent } = await import("./events");
    await recordOrderEvent(
      ctx,
      orderId,
      "payment",
      {
        amount: receipt.amount,
        currency: receipt.currency ?? before.currency,
        source: "receipt",
        ...(over > 0.01 ? { overpaid: over } : {}),
      },
      "system",
    );
  }
  return ok;
}

/** Причина для продавца, когда одобренный чек сменился другим файлом. */
export const PROOF_SWAPPED_NOTE =
  "OCR: пока проверялся чек, покупатель прислал другой файл — проверьте вручную";

/**
 * Повторная выдача по кнопке покупателя: выданный цифровой заказ снова
 * «оплачен», дальше — обычный deliverOrder. false — повторять нельзя
 * (физический, не выдан, чужой статус успел смениться).
 */
export async function reopenForResend(
  ctx: TenantContext,
  order: Pick<OrderRow, "id" | "status" | "fulfillment_kind">,
): Promise<boolean> {
  if (!canResendMaterials(order)) return false;
  const { data, error } = await ctx.db
    .from("orders")
    .update({ status: "paid" })
    .eq("id", order.id)
    .eq("status", "delivered")
    .select("id");
  if (error) throw serverFailure(`reopenForResend: заказ #${order.id}: ${error.message}`);
  return Boolean(data?.length);
}
