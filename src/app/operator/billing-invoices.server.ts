import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { logEvent, notifyOwner } from "./operator.server";
import { NO_RECIPIENTS_REASON } from "@/core/notify/deliver";
import { serverFailure } from "@/lib/server-failure";
import { getKaspiPayLink, getPayoutRequisites } from "./billing-settings.server";

/** Счета: список, выставление, чек. */

export type InvoiceStatus = "sent" | "proof_uploaded" | "paid" | "rejected" | "cancelled";

export type Invoice = {
  id: string;
  bot_id: string;
  amount: number;
  currency: string;
  note: string | null;
  requisites_snapshot: string;
  status: InvoiceStatus;
  has_proof: boolean;
  proof_uploaded_at: string | null;
  created_at: string;
  created_by: string | null;
  confirmed_at: string | null;
  reject_reason: string | null;
};

const SELECT =
  "id, bot_id, amount, currency, note, requisites_snapshot, status, proof_path, proof_uploaded_at, created_at, created_by, confirmed_at, reject_reason";

type Row = Omit<Invoice, "has_proof" | "status"> & { status: string; proof_path: string | null };

function toInvoice(r: Row): Invoice {
  const { proof_path, ...rest } = r;
  return {
    ...rest,
    amount: Number(r.amount),
    status: r.status as InvoiceStatus,
    has_proof: Boolean(proof_path),
  };
}

export async function listInvoices(botId?: string): Promise<Invoice[]> {
  // Постранично и с уникальным ключом в сортировке: старые неоплаченные счета не теряются.
  const rows = await pageAll<Row>((from, to) => {
    let q = serviceDb()
      .from("subscription_invoices")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (botId) q = q.eq("bot_id", botId);
    return q;
  }, "Счета не прочитаны");
  return rows.map(toInvoice);
}

export async function invoiceOrThrow(id: string): Promise<Invoice & { proof_path: string | null }> {
  const { data, error } = await serviceDb()
    .from("subscription_invoices")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw serverFailure(`Счёт не найден${error ? `: ${error.message}` : ""}`);
  return { ...toInvoice(data as Row), proof_path: (data as Row).proof_path };
}

/**
 * Способы оплаты подписки по порядку перебора: ссылка ApiPay, если ключ
 * задан в окружении, ссылка Kaspi Pay, если оператор её задал, потом перевод
 * по реквизитам (запасной путь).
 */
async function payProviders() {
  const { transferProvider } = await import("@/core/billing/pay/transfer");
  const { kaspiLinkProvider } = await import("@/core/billing/pay/kaspi-link");
  const { apipayProvider } = await import("@/core/billing/pay/apipay");
  const { apipayConfig } = await import("./apipay.server");
  // Не настроенный ApiPay не в списке вовсе: причина отказа счёта — про настроенные способы.
  const apipay = apipayConfig();
  return [
    ...(apipay ? [apipayProvider(apipay)] : []),
    kaspiLinkProvider(getKaspiPayLink),
    transferProvider,
  ];
}

/**
 * Счёт владельцу: текст с суммой и способом оплаты уходит через его же бота.
 * Недоставленное сообщение не откатывает счёт — он виден в панели, а сумму
 * можно передать любым другим каналом. Текст счёта готовит способ оплаты,
 * так что новый способ не трогает этот код.
 */
export async function createInvoice(
  botId: string,
  p: { amount: number; currency: string; note: string | null },
  actor: string,
  opts: {
    deliver?: boolean;
    /** После вставки и до выставления: сбой отменяет счёт, владелец его не получит. */
    beforeIssue?: (invoiceId: string) => Promise<void>;
  } = {},
): Promise<{
  invoice: Invoice;
  delivered: boolean;
  deliveryError: string | null;
  payUrl: string | null;
}> {
  const requisites = await getPayoutRequisites();
  const { availableProviders, issueWithFallback } = await import("@/core/billing/pay/provider");
  const reqBase = {
    botId,
    amount: p.amount,
    currency: p.currency,
    note: p.note,
    requisites,
    ownerPhone: null,
  };
  // Ни один способ не готов (например, нет реквизитов для перевода) — счёт не заводим.
  const { ready } = await availableProviders(await payProviders(), reqBase);
  const { data, error } = await serviceDb()
    .from("subscription_invoices")
    .insert({
      bot_id: botId,
      amount: p.amount,
      currency: p.currency,
      note: p.note,
      requisites_snapshot: requisites,
      created_by: actor,
    })
    .select(SELECT)
    .single();
  if (error || !data)
    throw serverFailure(`Не удалось создать счёт: ${error?.message ?? "нет данных"}`);
  const invoice = toInvoice(data as Row);
  // Способы могли отвалиться после вставки: тогда счёт остаётся в базе, а
  // владелец ничего не получает. Такой счёт сразу помечаем отменённым.
  let issued;
  try {
    await opts.beforeIssue?.(invoice.id);
    ({ issued } = await issueWithFallback(ready, { ...reqBase, invoiceId: invoice.id }));
  } catch (e) {
    await serviceDb()
      .from("subscription_invoices")
      .update({ status: "cancelled" })
      .eq("id", invoice.id)
      .eq("status", "sent");
    await logEvent(
      botId,
      "payment",
      { action: "invoice_cancelled", invoice_id: invoice.id, reason: "issue_failed" },
      actor,
    );
    await (
      await import("@/core/commission/invoice.server")
    ).releaseCommissionSafely(botId, invoice.id);
    throw e instanceof Error ? e : new Error(String(e));
  }
  await logEvent(
    botId,
    "payment",
    {
      action: "invoice_created",
      invoice_id: invoice.id,
      amount: p.amount,
      currency: p.currency,
      pay_provider: issued.provider,
    },
    actor,
  );
  const payUrl = issued.payUrl ?? null;
  if (opts.deliver === false) return { invoice, delivered: false, deliveryError: null, payUrl };
  try {
    const r = await notifyOwner(botId, issued.ownerText);
    return {
      invoice,
      payUrl,
      delivered: r.delivered.length > 0,
      deliveryError: r.delivered.length ? null : (r.failed[0]?.reason ?? NO_RECIPIENTS_REASON),
    };
  } catch (e) {
    return {
      invoice,
      payUrl,
      delivered: false,
      deliveryError: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function invoiceProofUrl(id: string): Promise<string | null> {
  const inv = await invoiceOrThrow(id);
  if (!inv.proof_path) return null;
  const { data, error } = await serviceDb()
    .storage.from("payment-proofs")
    .createSignedUrl(inv.proof_path, 300);
  if (error || !data) return null;
  return data.signedUrl;
}
