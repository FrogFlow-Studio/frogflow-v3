import { serviceDb } from "@/core/db/client.server";
import { AI_TOPUP_MAX_USD, AI_TOPUP_MIN_USD } from "@/core/ai/pure";
import { serverFailure } from "@/lib/server-failure";
import { shownError } from "@/lib/shown-error";

/**
 * Пополнение ИИ-баланса продавцом — обычный счёт владельцу
 * (subscription_invoices): та же ссылка Kaspi Pay или реквизиты, тот же чек
 * в бота и та же автопроверка, что у подписки. Отличает его метка
 * `ai_topup:<счёт>` в app_settings клиента с суммой в долларах: схема не
 * меняется, а сумма зачисления не зависит от курса в день оплаты.
 * Подтверждение такого счёта зачисляет доллары на баланс вместо платежа за
 * подписку (billing.server confirmInvoice).
 */
export const AI_TOPUP_PREFIX = "ai_topup:";

export type AiTopupMark = { usd: number; kzt: number };

export function parseTopupMark(raw: string | null | undefined): AiTopupMark | null {
  try {
    const v = JSON.parse(raw ?? "") as Partial<AiTopupMark>;
    const usd = Number(v.usd);
    const kzt = Number(v.kzt);
    return Number.isFinite(usd) && usd > 0 ? { usd, kzt: Number.isFinite(kzt) ? kzt : 0 } : null;
  } catch {
    return null;
  }
}

/** Какие из этих счетов — пополнения ИИ-баланса. */
export async function aiTopupMarks(
  botId: string,
  invoiceIds: string[],
): Promise<Map<string, AiTopupMark>> {
  const out = new Map<string, AiTopupMark>();
  if (!invoiceIds.length) return out;
  const { data, error } = await serviceDb()
    .from("app_settings")
    .select("key, value")
    .eq("bot_id", botId)
    .in(
      "key",
      invoiceIds.map((id) => `${AI_TOPUP_PREFIX}${id}`),
    );
  if (error) throw serverFailure(`Не удалось прочитать метки пополнения: ${error.message}`);
  for (const r of data ?? []) {
    const mark = parseTopupMark(r.value);
    if (mark) out.set(r.key.slice(AI_TOPUP_PREFIX.length), mark);
  }
  return out;
}

/** Открытые счета клиента без пополнений ИИ-баланса — для счетов подписки. */
export async function openSubscriptionInvoices<T extends { id: string }>(
  botId: string,
  rows: T[],
): Promise<T[]> {
  const marks = await aiTopupMarks(
    botId,
    rows.map((r) => r.id),
  );
  return rows.filter((r) => !marks.has(r.id));
}

export type AiTopupInvoice = {
  invoiceId: string;
  usd: number;
  amount: number;
  currency: string;
  note: string | null;
  payUrl: string | null;
  requisites: string | null;
  reused: boolean;
};

/**
 * «Пополнить» у владельца: счёт в тенге по курсу на сумму в долларах. Уже
 * открытый счёт пополнения на ту же сумму отдаётся снова (двойное нажатие);
 * на другую — прежний отменяется, пока по нему не прислали чек.
 */
export async function createAiTopup(
  botId: string,
  usdRaw: number,
  actor: string,
): Promise<AiTopupInvoice> {
  const usd = Math.round(usdRaw * 100) / 100;
  if (!Number.isFinite(usd) || usd < AI_TOPUP_MIN_USD || usd > AI_TOPUP_MAX_USD)
    throw shownError(`Сумма пополнения — от ${AI_TOPUP_MIN_USD} до ${AI_TOPUP_MAX_USD} $.`);
  const billing = await import("./billing.server");
  const { normalizeKaspiLink } = await import("@/core/billing/pay/kaspi-link");
  const { data: open, error } = await serviceDb()
    .from("subscription_invoices")
    .select("id, amount, currency, note, requisites_snapshot, created_at")
    .eq("bot_id", botId)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw serverFailure(`Не удалось прочитать счета: ${error.message}`);
  const marks = await aiTopupMarks(
    botId,
    (open ?? []).map((r) => r.id),
  );
  for (const inv of open ?? []) {
    const mark = marks.get(inv.id);
    if (!mark) continue;
    if (mark.usd === usd) {
      const payUrl =
        inv.currency === "KZT" ? normalizeKaspiLink(await billing.getKaspiPayLink()) : null;
      return {
        invoiceId: inv.id,
        usd,
        amount: Number(inv.amount),
        currency: inv.currency,
        note: inv.note,
        payUrl,
        requisites: payUrl ? null : inv.requisites_snapshot,
        reused: true,
      };
    }
    // Чек успели прислать — отмена откажет, и такой счёт ждёт проверки.
    await billing.cancelInvoice(inv.id, actor).catch(() => {});
  }
  const { convertForTenant } = await import("@/core/pricing/pricing");
  const kzt = await convertForTenant(usd, "USD", "KZT");
  if (!kzt || kzt <= 0) throw shownError("Курс доллара сейчас недоступен — попробуйте позже.");
  const r = await billing.createInvoice(
    botId,
    { amount: kzt, currency: "KZT", note: `Пополнение ИИ-баланса на ${usd} $` },
    actor,
    {
      // Метка — до того, как счёт уйдёт владельцу: оплаченный счёт без неё
      // продлил бы подписку вместо пополнения.
      beforeIssue: async (invoiceId) => {
        const { error: markError } = await serviceDb()
          .from("app_settings")
          .insert({
            bot_id: botId,
            key: `${AI_TOPUP_PREFIX}${invoiceId}`,
            value: JSON.stringify({ usd, kzt }),
          });
        if (markError)
          throw serverFailure(`Не удалось отметить счёт пополнения: ${markError.message}`);
      },
    },
  );
  return {
    invoiceId: r.invoice.id,
    usd,
    amount: r.invoice.amount,
    currency: r.invoice.currency,
    note: r.invoice.note,
    payUrl: r.payUrl,
    requisites: r.payUrl ? null : r.invoice.requisites_snapshot,
    reused: false,
  };
}

/** Зачисление по оплаченному счёту пополнения; null — не зачислено (баланс меняется). */
export async function creditAiTopup(
  botId: string,
  invoiceId: string,
  mark: AiTopupMark,
  actor: string,
) {
  const { requireTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { aiCredit } = await import("@/core/ai/balance");
  const ctx = tenantContext(await requireTenant({ by: "id", value: botId }));
  return aiCredit(ctx, {
    kind: "topup",
    usd: mark.usd,
    note: `Счёт ${invoiceId.slice(0, 8)} на ${mark.kzt} ₸`,
    actor,
    invoiceId,
  });
}

/**
 * Оплаченные счета пополнения, по которым в журнале ИИ-баланса нет записи
 * о зачислении: зачисление сорвалось (база, гонка) — у счёта кнопка
 * «Зачислить повторно».
 */
export async function uncreditedAiTopups(
  botId: string,
  paidInvoiceIds: string[],
): Promise<string[]> {
  const marks = await aiTopupMarks(botId, paidInvoiceIds);
  if (!marks.size) return [];
  const { AI_LEDGER_PREFIX } = await import("@/core/ai/balance");
  const { data, error } = await serviceDb()
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId)
    .like("key", `${AI_LEDGER_PREFIX}%`)
    .order("key", { ascending: false })
    .limit(500);
  if (error) throw serverFailure(`Не удалось прочитать журнал ИИ-баланса: ${error.message}`);
  const credited = new Set<string>();
  for (const r of data ?? []) {
    try {
      const inv = (JSON.parse(r.value ?? "") as { invoiceId?: unknown }).invoiceId;
      if (typeof inv === "string") credited.add(inv);
    } catch {
      /* испорченная запись журнала — не наша забота здесь */
    }
  }
  return [...marks.keys()].filter((id) => !credited.has(id));
}

/**
 * «Зачислить повторно» у оплаченного счёта пополнения. Безопасно при любом
 * исходе первой попытки: aiCredit помнит зачисленные счета и второй раз
 * доллары не начисляет, только дописывает недостающую запись журнала.
 */
export async function recreditAiTopup(invoiceId: string, actor: string) {
  const { data: inv, error } = await serviceDb()
    .from("subscription_invoices")
    .select("id, bot_id, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw serverFailure(`Не удалось прочитать счёт: ${error.message}`);
  if (!inv) throw shownError("Счёт не найден.");
  if (inv.status !== "paid") throw shownError("Зачислить можно только оплаченный счёт.");
  const mark = (await aiTopupMarks(inv.bot_id, [invoiceId])).get(invoiceId);
  if (!mark) throw shownError("Это не счёт пополнения ИИ-баланса.");
  // Запись в журнале — зачисление было. Память баланса о счетах короткая
  // (последние AI_TOPUP_SEEN), поэтому решает журнал: старая кнопка или
  // прямой вызов по давнему счёту второй раз не зачислит.
  const { requireTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const { ledgerHasInvoice } = await import("@/core/ai/balance");
  const ctx = tenantContext(await requireTenant({ by: "id", value: inv.bot_id }));
  if (await ledgerHasInvoice(ctx, invoiceId)) throw shownError("Уже зачислено.");
  const after = await creditAiTopup(inv.bot_id, invoiceId, mark, actor);
  if (!after) throw shownError("ИИ-баланс сейчас меняется — нажмите ещё раз.");
  const { logEvent } = await import("./operator.server");
  await logEvent(
    inv.bot_id,
    "payment",
    { action: "ai_topup_recredited", invoice_id: invoiceId, usd: mark.usd },
    actor,
  );
  return after;
}
