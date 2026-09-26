import type { TenantContext } from "@/core/tenant/resolve.server";
import { serviceDb } from "@/core/db/client.server";

/**
 * Счёт оператора владельцу бота — часть, которую видит сам бот: владелец
 * отвечает на счёт фото или файлом чека, тем же жестом, что покупатель с
 * чеком по заказу. Чек лежит в общем бакете payment-proofs в папке
 * invoice-<id>, статус переводится под RLS арендатора (колоночный UPDATE
 * на status/proof_path/proof_uploaded_at, M60).
 */
export type OpenInvoice = {
  id: string;
  amount: number;
  currency: string;
  note: string | null;
  created_at: string;
};

/** Старейший открытый счёт — если отправитель владелец бота; иначе null. */
export async function openInvoiceForOwner(
  ctx: TenantContext,
  telegramId: number,
): Promise<OpenInvoice | null> {
  if (!ctx.tenant.ownerTelegramId || Number(ctx.tenant.ownerTelegramId) !== Number(telegramId))
    return null;
  const { data } = await ctx.db
    .from("subscription_invoices")
    .select("id, amount, currency, note, created_at")
    .eq("status", "sent")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? { ...data, amount: Number(data.amount) } : null;
}

export type AttachInvoiceProofResult =
  { ok: true; invoice: OpenInvoice } | { ok: false; reason: "upload_failed" | "already_processed" };

export async function attachInvoiceProof(
  ctx: TenantContext,
  invoice: OpenInvoice,
  file: { bytes: Uint8Array; mime: string; ext: string },
): Promise<AttachInvoiceProofResult> {
  const key = `${ctx.tenant.id}/invoice-${invoice.id}/${Date.now()}.${file.ext}`;
  const up = await serviceDb()
    .storage.from("payment-proofs")
    .upload(key, new Blob([file.bytes as BlobPart], { type: file.mime }), {
      contentType: file.mime,
      upsert: true,
    });
  if (up.error) {
    console.error("[billing] invoice proof upload failed", up.error.message);
    return { ok: false, reason: "upload_failed" };
  }
  // CAS по статусу: второе фото почти одновременно с первым не должно
  // получить «чек получен», если счёт уже ушёл дальше.
  const { data, error } = await ctx.db
    .from("subscription_invoices")
    .update({
      status: "proof_uploaded",
      proof_path: key,
      proof_uploaded_at: new Date().toISOString(),
    })
    .eq("id", invoice.id)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, reason: "already_processed" };
  return { ok: true, invoice };
}
