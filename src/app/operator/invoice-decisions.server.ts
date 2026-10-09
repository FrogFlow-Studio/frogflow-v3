import { serviceDb } from "@/core/db/client.server";
import { operationKey } from "@/core/billing/invoice-check";
import { InvoiceAlreadyHandled } from "@/core/billing/invoice-state";
import { logEvent } from "./operator.server";
import { serverFailure } from "@/lib/server-failure";
import { reportError } from "@/lib/errors";
import { shownError } from "@/lib/shown-error";
import { addPayment } from "./billing-payments.server";
import { invoiceOrThrow } from "./billing-invoices.server";

/** Решения по счёту: подтверждение, отказ, отмена. */

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
  if (error) throw serverFailure(error.message);
  if (!done) throw new Error("Счёт уже обработан — обновите список");
  await logEvent(
    inv.bot_id,
    "payment",
    { action: "invoice_rejected", invoice_id: id, reason: reason.trim() || null },
    actor,
  );
  await (await import("@/core/commission/invoice.server")).releaseCommissionSafely(inv.bot_id, id);
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
  if (error) throw serverFailure(error.message);
  if (!done) throw new Error("Счёт уже обработан — обновите список");
  await logEvent(inv.bot_id, "payment", { action: "invoice_cancelled", invoice_id: id }, actor);
  await (await import("@/core/commission/invoice.server")).releaseCommissionSafely(inv.bot_id, id);
}
