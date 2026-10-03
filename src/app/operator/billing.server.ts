import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import {
  computeState,
  readPolicy,
  suspendText,
  warnText,
  type OverduePolicy,
} from "@/core/billing/subscription";
import { operationKey } from "@/core/billing/invoice-check";
import { InvoiceAlreadyHandled } from "@/core/billing/invoice-state";
import type { Tenant } from "@/core/tenant/types";
import { logEvent, notifyOwner } from "./operator.server";
import { NO_RECIPIENTS_REASON } from "@/core/notify/deliver";
import { serverFailure } from "@/lib/server-failure";
import { reportError } from "@/lib/errors";
import { shownError } from "@/lib/shown-error";
import { inChunks } from "@/lib/in-chunks";
import { trialState } from "@/core/plans/trial";

/**
 * Подписка клиента на платформу: платежи (subscription_payments — срок
 * bots.subscription_expires_at пересчитывает триггер, второго источника
 * истины нет) и счета владельцу (subscription_invoices): выставлено → чек
 * прислан → подтверждено или отклонено. Подтверждение не изобретает свою
 * бухгалтерию — заводит обычный платёж.
 */
const REQUISITES_KEY = "payout_requisites";

export async function getPayoutRequisites(): Promise<string> {
  const { data, error: readErr4 } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", REQUISITES_KEY)
    .maybeSingle();
  if (readErr4) throw serverFailure(`[billing] реквизиты не прочитаны: ${readErr4.message}`);
  return data?.value ?? "";
}

async function setOperatorSetting(key: string, value: string): Promise<void> {
  const db = serviceDb();
  const v = value.trim();
  const { data, error: readErr3 } = await db
    .from("operator_settings")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (readErr3) throw serverFailure(`[billing] настройка не прочитана: ${readErr3.message}`);
  const { error } = data
    ? await db.from("operator_settings").update({ value: v }).eq("key", key)
    : await db.from("operator_settings").insert({ key, value: v });
  if (error) throw serverFailure(`Не удалось сохранить настройку: ${error.message}`);
}

export async function setPayoutRequisites(value: string): Promise<void> {
  await setOperatorSetting(REQUISITES_KEY, value);
}

/** Получатель в чеке Kaspi для автопроверки чеков за подписку. */
export async function setPayoutRecipient(value: string): Promise<void> {
  const { RECIPIENT_KEY } = await import("@/core/billing/invoice-check.server");
  await setOperatorSetting(RECIPIENT_KEY, value);
}

export type Payment = {
  id: string;
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  paid_at: string;
  note: string | null;
};

export async function listPayments(botId: string): Promise<Payment[]> {
  const { data, error } = await serviceDb()
    .from("subscription_payments")
    .select("id, period_start, period_end, amount, currency, paid_at, note")
    .eq("bot_id", botId)
    .order("period_end", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ ...p, amount: Number(p.amount) }));
}

export type NewPayment = {
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  note: string | null;
};

export async function subscriptionExpiresAt(botId: string): Promise<string | null> {
  const { data, error: readErr2 } = await serviceDb()
    .from("bots")
    .select("subscription_expires_at")
    .eq("id", botId)
    .maybeSingle();
  if (readErr2) throw serverFailure(`[billing] срок подписки не прочитан: ${readErr2.message}`);
  return data?.subscription_expires_at ?? null;
}

/** Платёж; если бот был приостановлен за просрочку и новый срок в будущем — возвращаем в работу. */
export async function addPayment(
  botId: string,
  p: NewPayment,
  actor: string,
): Promise<{ expiresAt: string | null }> {
  const db = serviceDb();
  const { error } = await db.from("subscription_payments").insert({ bot_id: botId, ...p });
  if (error) throw serverFailure(`Не удалось записать платёж: ${error.message}`);
  await logEvent(
    botId,
    "payment",
    { action: "added", period_end: p.period_end, amount: p.amount, currency: p.currency },
    actor,
  );
  const { data: bot, error: botErr } = await db
    .from("bots")
    .select("status, subscription_expires_at")
    .eq("id", botId)
    .maybeSingle();
  if (botErr) throw serverFailure(`[billing] бот не прочитан после платежа: ${botErr.message}`);
  const expiresAt = bot?.subscription_expires_at ?? null;
  if (bot?.status === "suspended" && expiresAt && new Date(expiresAt).getTime() > Date.now()) {
    await db.from("bots").update({ status: "active" }).eq("id", botId);
    const { invalidateTenantDirectory } = await import("@/core/tenant/resolve.server");
    invalidateTenantDirectory();
    await logEvent(botId, "resume", { reason: "payment_covers_arrears" }, actor);
  }
  return { expiresAt };
}

export async function deletePayment(
  botId: string,
  paymentId: string,
  actor: string,
): Promise<void> {
  const { error } = await serviceDb()
    .from("subscription_payments")
    .delete()
    .eq("id", paymentId)
    .eq("bot_id", botId);
  if (error) throw new Error(error.message);
  await logEvent(botId, "payment", { action: "deleted", payment_id: paymentId }, actor);
}

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

async function invoiceOrThrow(id: string): Promise<Invoice & { proof_path: string | null }> {
  const { data, error } = await serviceDb()
    .from("subscription_invoices")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw serverFailure(`Счёт не найден${error ? `: ${error.message}` : ""}`);
  return { ...toInvoice(data as Row), proof_path: (data as Row).proof_path };
}

/** Ссылка Kaspi Pay платформы (core/billing/pay/kaspi-link); пусто — не задана. */
export async function getKaspiPayLink(): Promise<string> {
  const { KASPI_LINK_KEY } = await import("@/core/billing/pay/kaspi-link");
  const { data, error: readErr } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", KASPI_LINK_KEY)
    .maybeSingle();
  if (readErr) throw serverFailure(`[billing] ссылка Kaspi Pay не прочитана: ${readErr.message}`);
  return data?.value?.trim() ?? "";
}

export async function setKaspiPayLink(value: string): Promise<void> {
  const { KASPI_LINK_KEY, normalizeKaspiLink } = await import("@/core/billing/pay/kaspi-link");
  const link = value.trim() ? normalizeKaspiLink(value) : "";
  if (link === null)
    throw new Error("Ссылка Kaspi Pay должна начинаться с https:// и вести на kaspi.kz.");
  await setOperatorSetting(KASPI_LINK_KEY, link);
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

/**
 * Подтверждение = платёж за период. Захват счёта условным UPDATE: двойной
 * клик или два оператора не дадут двух платежей; если платёж не записался
 * — статус откатывается, счёт остаётся подтверждаемым.
 */
export async function confirmInvoice(
  id: string,
  period: { start: string; end: string },
  actor: string,
  /** Номер операции из чека (автопроверка) — в событие сбоя зачисления. */
  receiptOp?: string,
): Promise<{ expiresAt: string | null }> {
  const inv = await invoiceOrThrow(id);
  if (inv.status !== "sent" && inv.status !== "proof_uploaded")
    throw new InvoiceAlreadyHandled(`Счёт уже в статусе «${inv.status}» — подтверждать нечего`);
  if (period.end < period.start) throw new Error("Конец периода раньше начала");
  const db = serviceDb();
  const { data: claimed, error } = await db
    .from("subscription_invoices")
    .update({ status: "paid", confirmed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["sent", "proof_uploaded"])
    .select("id")
    .maybeSingle();
  if (error) throw serverFailure(`Не удалось подтвердить счёт: ${error.message}`);
  if (!claimed) throw new InvoiceAlreadyHandled("Счёт уже обработан — обновите список");
  /**
   * Вернуть счёт в прежний статус. Не вышло — счёт остался «оплачен» без
   * платежа или зачисления: сам он больше не подтвердится, только оператор,
   * поэтому в журнал клиента и в учёт ошибок.
   */
  const rollback = async () => {
    const { error: failed } = await db
      .from("subscription_invoices")
      .update({ status: inv.status, confirmed_at: null })
      .eq("id", id);
    if (!failed) return;
    await logEvent(
      inv.bot_id,
      "payment",
      {
        action: "invoice_paid_without_payment",
        invoice_id: id,
        amount: inv.amount,
        currency: inv.currency,
        error: failed.message,
      },
      actor,
    );
    await reportError(
      serverFailure(`Счёт ${id} остался оплаченным без платежа: ${failed.message}`),
      { where: "billing.confirmInvoice", botId: inv.bot_id },
    );
  };
  // Счёт пополнения ИИ-баланса: оплата зачисляет доллары, подписку не продлевает.
  // Метка читается после захвата: сбой чтения возвращает счёт в прежний статус.
  const { aiTopupMarks, creditAiTopup } = await import("./ai-topup.server");
  let topup;
  try {
    topup = (await aiTopupMarks(inv.bot_id, [id])).get(id) ?? null;
  } catch (e) {
    await rollback();
    throw e;
  }
  if (topup) {
    let after;
    try {
      after = await creditAiTopup(inv.bot_id, id, topup, actor);
    } catch (e) {
      // Неизвестно, успел ли баланс измениться: счёт остаётся оплаченным, а
      // оператор жмёт «Зачислить повторно» — зачисление по счёту идемпотентно
      // (core/ai/balance aiCredit), второй раз не начислит.
      const detail = e instanceof Error ? e.message : String(e);
      await logEvent(
        inv.bot_id,
        "payment",
        {
          action: "ai_topup_failed",
          invoice_id: id,
          amount: inv.amount,
          currency: inv.currency,
          usd: topup.usd,
          ...(receiptOp ? { receipt_op: receiptOp } : {}),
          error: detail,
        },
        actor,
      );
      await reportError(e, {
        where: "billing.ai_topup",
        botId: inv.bot_id,
        extra: { invoice_id: id, usd: topup.usd, receipt_op: receiptOp ?? null },
      });
      throw serverFailure(
        `Счёт оплачен, но зачисление на ИИ-баланс не подтвердилось: ${detail}. Нажмите «Зачислить повторно» у счёта.`,
      );
    }
    if (!after) {
      await rollback();
      throw shownError("ИИ-баланс сейчас меняется — подтвердите счёт ещё раз.");
    }
    await logEvent(
      inv.bot_id,
      "payment",
      {
        action: "invoice_confirmed",
        invoice_id: id,
        amount: inv.amount,
        currency: inv.currency,
        ai_topup_usd: topup.usd,
      },
      actor,
    );
    return { expiresAt: null };
  }
  let r: { expiresAt: string | null };
  try {
    r = await addPayment(
      inv.bot_id,
      {
        period_start: period.start,
        period_end: period.end,
        amount: inv.amount,
        currency: inv.currency,
        note: inv.note ? `Счёт: ${inv.note}` : "По счёту из панели оператора",
      },
      actor,
    );
  } catch (e) {
    await rollback();
    throw e;
  }
  // Платёж записан — счёт оплачен, дальше его не откатываем: иначе повторное
  // подтверждение записало бы второй платёж.
  await logEvent(
    inv.bot_id,
    "payment",
    { action: "invoice_confirmed", invoice_id: id, amount: inv.amount, currency: inv.currency },
    actor,
  );
  try {
    // Счёт по плану с подключением — подключение теперь оплачено.
    await (await import("./plans.server")).onInvoicePaid(inv.bot_id, id);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[billing] onInvoicePaid ${id} failed: ${detail}`);
    await logEvent(
      inv.bot_id,
      "payment",
      { action: "invoice_paid_hook_failed", invoice_id: id, error: detail },
      actor,
    );
  }
  return r;
}

/**
 * Итог автопроверки чека за подписку. Отпечаток файла и номер операции
 * пишутся всегда — по ним тот же чек по другому счёту не пройдёт. Прошёл проверку — счёт
 * подтверждается сам на следующий период клиента; нет — остаётся «чек
 * прислан» и ждёт оператора, причина видна в журнале клиента.
 */
export async function settleInvoiceProof(
  botId: string,
  invoiceId: string,
  check: import("@/core/billing/invoice-check.server").InvoiceProofCheck,
): Promise<{ confirmed: true; expiresAt: string | null } | { confirmed: false; detail: string }> {
  await logEvent(
    botId,
    "payment",
    {
      action: "invoice_proof",
      invoice_id: invoiceId,
      proof_hash: check.hash,
      ...(check.operationId
        ? { receipt_op: check.operationId, receipt_op_key: operationKey(check.operationId) }
        : {}),
      auto_check: check.ok ? "passed" : check.detail,
    },
    "auto-check",
  );
  if (!check.ok) return { confirmed: false, detail: check.detail };
  // Повтор, который проверка до записи не увидела (два чека почти разом):
  // после своей отметки ещё раз смотрим, нет ли отметок других счетов.
  const { claimReceipt } = await import("@/core/billing/invoice-check.server");
  const dup = await claimReceipt(invoiceId, check);
  if (dup) {
    await logEvent(
      botId,
      "payment",
      { action: "invoice_proof_duplicate", invoice_id: invoiceId, detail: dup },
      "auto-check",
    );
    return { confirmed: false, detail: dup };
  }
  try {
    const period = await (await import("./plans.server")).suggestedPeriod(botId);
    const r = await confirmInvoice(invoiceId, period, "auto-check", check.operationId);
    return { confirmed: true, expiresAt: r.expiresAt };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[billing] auto-confirm ${invoiceId} failed: ${detail}`);
    return { confirmed: false, detail };
  }
}

export async function rejectInvoice(id: string, reason: string, actor: string): Promise<void> {
  const inv = await invoiceOrThrow(id);
  if (inv.status === "paid") throw new Error("Счёт уже оплачен — отклонять нечего");
  if (inv.status !== "sent" && inv.status !== "proof_uploaded")
    throw new Error(`Счёт уже в статусе «${inv.status}» — отклонять нечего`);
  // Условно по статусу: подтверждение, прошедшее между чтением и записью,
  // не должно превратиться в «отклонено».
  const { data: done, error } = await serviceDb()
    .from("subscription_invoices")
    .update({ status: "rejected", reject_reason: reason.trim() || null })
    .eq("id", id)
    .in("status", ["sent", "proof_uploaded"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!done) throw new Error("Счёт уже обработан — обновите список");
  await logEvent(
    inv.bot_id,
    "payment",
    { action: "invoice_rejected", invoice_id: id, reason: reason.trim() || null },
    actor,
  );
}

/** Отменить можно только счёт, по которому ещё не прислали чек — иначе это «отклонить». */
export async function cancelInvoice(id: string, actor: string): Promise<void> {
  const inv = await invoiceOrThrow(id);
  if (inv.status !== "sent")
    throw new Error("Отменить можно только счёт, по которому ещё не прислали чек");
  // Условно по статусу: чек или подтверждение, пришедшие между чтением и
  // записью, не затираются отменой.
  const { data: done, error } = await serviceDb()
    .from("subscription_invoices")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!done) throw new Error("Счёт уже обработан — обновите список");
  await logEvent(inv.bot_id, "payment", { action: "invoice_cancelled", invoice_id: id }, actor);
}

/* ── обход подписок ─────────────────────────────────────────────────── */

export type SweepAction = "warned" | "suspended" | "skipped" | "failed";
export type SweepEntry = {
  bot_id: string;
  bot_name: string;
  state: string;
  action: SweepAction;
  detail: string;
};
export type SweepNotify = (botId: string, text: string) => Promise<{ ok: boolean; detail: string }>;

const defaultNotify: SweepNotify = async (botId, text) => {
  try {
    const r = await notifyOwner(botId, text);
    return r.delivered.length
      ? { ok: true, detail: "доставлено" }
      : { ok: false, detail: r.failed[0]?.reason ?? NO_RECIPIENTS_REASON };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * Счёт за следующий период, который обход выставляет сам: только клиенту на
 * плане (ниша × уровень) и только если открытого счёта ещё нет. null —
 * выставлять нечего.
 */
export type SweepInvoicer = (t: Tenant) => Promise<{ amount: number; delivered: boolean } | null>;

const defaultInvoicer: SweepInvoicer = async (t) => {
  const { parsePlan } = await import("@/core/plans/registry");
  if (parsePlan(t.plan)?.kind !== "tier") return null;
  const { data: open, error: openErr } = await serviceDb()
    .from("subscription_invoices")
    .select("id")
    .eq("bot_id", t.id)
    .in("status", ["sent", "proof_uploaded"])
    .limit(20);
  if (openErr) throw serverFailure(`[billing] открытые счета не прочитаны: ${openErr.message}`);
  // Открытое пополнение ИИ-баланса не заменяет счёт за подписку.
  const { openSubscriptionInvoices } = await import("./ai-topup.server");
  if ((await openSubscriptionInvoices(t.id, open ?? [])).length) return null;
  const r = await (
    await import("./plans.server")
  ).createPlanInvoice(
    t.id,
    { period: t.settings.billing?.period ?? "month", addonPrices: {} },
    "cron",
  );
  return { amount: r.invoice.amount, delivered: r.delivered };
};

async function alreadyDone(botId: string, marker: string): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("bot_events")
    .select("id")
    .eq("bot_id", botId)
    .eq("payload->>sweep_marker", marker)
    .limit(1);
  // Отказ проверки — не повод действовать: лучше пропустить клиента на этом проходе, чем разослать дубль.
  if (error) {
    console.error(`[operator] sweep idempotency check failed for ${botId}: ${error.message}`);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Занять действие обхода ДО его выполнения: проверка `alreadyDone` читает метку,
 * а пишется она после отправки, и два обхода, пришедшие одновременно (окно
 * переключения v2 → v3), прошли бы проверку оба. Занимает вставка строки с
 * уникальным event_id в zernio_logs: проигравший (23505) действие пропускает.
 * Не удалось записать — тоже пропуск: лучше без письма и счёта, чем с двумя.
 */
async function claimSweep(botId: string, marker: string): Promise<boolean> {
  const { error } = await serviceDb()
    .from("zernio_logs")
    .insert({
      bot_id: botId,
      event_id: `sweep:${botId}:${marker}`,
      event_type: "sweep.claim",
      status: "processed",
      payload: { marker },
    });
  if (error && error.code !== "23505")
    console.error(`[operator] sweep claim failed for ${botId}: ${error.message}`);
  return !error;
}

/** Действие не состоялось — снять занятость, чтобы следующий проход повторил. */
async function releaseSweep(botId: string, marker: string): Promise<void> {
  const { error } = await serviceDb()
    .from("zernio_logs")
    .delete()
    .eq("event_id", `sweep:${botId}:${marker}`);
  if (error) console.error(`[operator] sweep release failed for ${botId}: ${error.message}`);
}

/**
 * Ежедневный обход подписок клиентов на v2: предупредить заранее, применить
 * политику после отсрочки. Идемпотентность — метка `sweep_marker` в
 * bot_events (вид действия + период + день): warn уходит раз в день, пока не
 * оплачено; suspend — один раз на период; недоставленное предупреждение не
 * помечается сделанным и повторится на следующем проходе.
 */
export async function sweepSubscriptions(
  now = new Date(),
  notify: SweepNotify = defaultNotify,
  /** Только один клиент (тесты) — без фильтра по served_by. */
  onlyBotId?: string,
  invoicer: SweepInvoicer = defaultInvoicer,
): Promise<SweepEntry[]> {
  const { tenantDirectory, invalidateTenantDirectory } =
    await import("@/core/tenant/resolve.server");
  const tenants = (await tenantDirectory(true)).filter((t) =>
    onlyBotId ? t.id === onlyBotId : t.settings.served_by === "v2" && !t.archived,
  );
  const ids = tenants.map((t) => t.id);
  // Не прочиталось — не «срока нет»: иначе обход молча пропустит всех просроченных.
  const rows = await inChunks(
    ids,
    (chunk) => serviceDb().from("bots").select("id, subscription_expires_at").in("id", chunk),
    "[billing] сроки подписок не прочитаны",
  );
  const expires = new Map(rows.map((r) => [r.id, r.subscription_expires_at]));
  const results: SweepEntry[] = [];
  const dayKey = now.toISOString().slice(0, 10);

  for (const t of tenants) {
    const policy: OverduePolicy = readPolicy(t.settings);
    const sub = computeState(expires.get(t.id) ?? null, policy, now);
    const base = { bot_id: t.id, bot_name: t.name, state: sub.state };
    if (sub.state === "no_data" || sub.state === "ok" || t.status === "suspended") {
      results.push({ ...base, action: "skipped", detail: "нет повода" });
      continue;
    }
    const shouldSuspend = sub.state === "grace_over" && policy.on_overdue === "suspend";
    const marker = shouldSuspend ? `suspend:${sub.expiresAt}` : `warn:${sub.expiresAt}:${dayKey}`;
    if (await alreadyDone(t.id, marker)) {
      results.push({ ...base, action: "skipped", detail: "уже сделано" });
      continue;
    }
    if (!(await claimSweep(t.id, marker))) {
      results.push({ ...base, action: "skipped", detail: "уже сделано" });
      continue;
    }
    if (shouldSuspend) {
      const { error } = await serviceDb()
        .from("bots")
        .update({ status: "suspended" })
        .eq("id", t.id);
      if (error) {
        await releaseSweep(t.id, marker);
        results.push({
          ...base,
          action: "failed",
          detail: `не удалось приостановить: ${error.message}`,
        });
        continue;
      }
      invalidateTenantDirectory();
      await logEvent(
        t.id,
        "suspend",
        { reason: "subscription_overdue", sweep_marker: marker },
        "cron",
      );
      const n = await notify(t.id, suspendText(sub.daysLeft));
      results.push({
        ...base,
        action: "suspended",
        detail: n.ok ? "приостановлен, владелец уведомлён" : `приостановлен; ${n.detail}`,
      });
      continue;
    }
    // Счёт на следующий период — один раз на срок, до напоминания: владелец
    // получает сумму и реквизиты Kaspi и отвечает чеком.
    const invoiceMarker = `invoice:${sub.expiresAt}`;
    if (!(await alreadyDone(t.id, invoiceMarker)) && (await claimSweep(t.id, invoiceMarker))) {
      try {
        const inv = await invoicer(t);
        if (inv)
          await logEvent(
            t.id,
            "payment",
            { action: "auto_invoice", amount: inv.amount, sweep_marker: invoiceMarker },
            "cron",
          );
        // Выставлять нечего (клиент не на плане) — не занимаем период.
        else await releaseSweep(t.id, invoiceMarker);
      } catch (e) {
        await releaseSweep(t.id, invoiceMarker);
        console.error(
          `[operator] auto invoice for ${t.id} failed: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    // Пробный период: общее «заканчивается подписка» не шлём — продавцу уже идут
    // свои два напоминания (trial-remind.server.ts), счёт выше выставлен как обычно.
    if (
      sub.state === "expiring" &&
      trialState(t.settings.billing, expires.get(t.id) ?? null, dayKey)
    ) {
      results.push({
        ...base,
        action: "skipped",
        detail: "пробный период: напоминает отдельный обход",
      });
      continue;
    }
    const n = await notify(t.id, warnText(sub.daysLeft, policy.on_overdue === "suspend"));
    if (!n.ok) {
      await releaseSweep(t.id, marker);
      results.push({ ...base, action: "failed", detail: n.detail });
      continue;
    }
    await logEvent(t.id, "message", { kind: "subscription_warning", sweep_marker: marker }, "cron");
    results.push({ ...base, action: "warned", detail: "владелец предупреждён" });
  }
  return results;
}

export async function setOverduePolicy(
  botId: string,
  policy: OverduePolicy,
  actor: string,
): Promise<void> {
  const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
  await patchTenantSettings(botId, policy);
  await logEvent(botId, "meta", { policy }, actor);
}
