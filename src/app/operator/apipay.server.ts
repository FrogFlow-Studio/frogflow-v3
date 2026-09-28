import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import type { ApipayConfig, ApipayEvent } from "@/core/billing/pay/apipay";
import { serverFailure } from "@/lib/server-failure";
import { logEvent } from "./operator.server";

/**
 * Приём оплат ApiPay по счетам платформы (subscription_invoices): вебхук
 * `/api/apipay/webhook` → сюда. Подтверждение — тот же confirmInvoice, что у
 * оператора и автопроверки чека: подписка продлевается на следующий период,
 * пополнение ИИ-баланса зачисляется (там это решает сам confirmInvoice).
 */
export function apipayConfig(): ApipayConfig | null {
  let e;
  try {
    e = env();
  } catch {
    // Окружение без платформенных секретов (тесты счетов): ApiPay просто нет.
    return null;
  }
  const apiKey = e.APIPAY_API_KEY?.trim();
  if (!apiKey) return null;
  const sandboxBotId = e.APIPAY_SANDBOX_BOT_ID?.trim() || null;
  return {
    apiKey,
    baseUrl: (e.APIPAY_BASE_URL?.trim() || "https://api.apipay.kz/api/v1").replace(/\/+$/, ""),
    live: e.APIPAY_LIVE.trim() === "1",
    sandboxBotId,
  };
}

export type SettleResult = { status: number; body: string };

type InvoiceRow = {
  id: string;
  bot_id: string;
  amount: number | string;
  currency: string;
  status: string;
};

const ACTOR = "apipay";

async function readInvoice(id: string): Promise<InvoiceRow | null> {
  const { data, error } = await serviceDb()
    .from("subscription_invoices")
    .select("id, bot_id, amount, currency, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw serverFailure(`Не удалось прочитать счёт ${id}: ${error.message}`);
  return (data as InvoiceRow | null) ?? null;
}

export type SettleDeps = {
  config: () => ApipayConfig | null;
  readInvoice: (id: string) => Promise<InvoiceRow | null>;
  /** Бросает InvoiceAlreadyHandled, если счёт уже закрыт; любой другой отказ — сбой. */
  confirm: (invoiceId: string, botId: string) => Promise<{ expiresAt: string | null }>;
  log: (botId: string, payload: Record<string, unknown>) => Promise<void>;
  /** Эта оплата ApiPay уже закрыла счёт раньше (событие apipay_paid с её id). */
  hasPaidEvent: (botId: string, apipayId: string) => Promise<boolean>;
  /** Деньги пришли, а применить их сам вебхук не может: учёт ошибок, оператору. */
  alert: (botId: string, message: string, extra: Record<string, string | number>) => Promise<void>;
  notifyOwner: (botId: string, text: string) => Promise<void>;
};

async function hasPaidEvent(botId: string, apipayId: string): Promise<boolean> {
  const { count, error } = await serviceDb()
    .from("bot_events")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId)
    .eq("kind", "payment")
    .eq("payload->>action", "apipay_paid")
    .eq("payload->>apipay_invoice_id", apipayId);
  if (error) throw serverFailure(`Не удалось прочитать журнал оплат ApiPay: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function liveSettleDeps(): Promise<SettleDeps> {
  const billing = await import("./billing.server");
  const plans = await import("./plans.server");
  const { runInBackground } = await import("@/lib/background");
  const { reportError } = await import("@/lib/errors");
  return {
    config: apipayConfig,
    readInvoice,
    confirm: async (invoiceId, botId) =>
      billing.confirmInvoice(invoiceId, await plans.suggestedPeriod(botId), ACTOR),
    log: (botId, payload) => logEvent(botId, "payment", payload, ACTOR),
    hasPaidEvent,
    alert: (botId, message, extra) =>
      reportError(new Error(message), { where: "apipay-webhook", botId, extra }),
    // Ответ ApiPay ждёт не дольше 5 секунд: сообщение владельцу — после ответа.
    // Клиенту прежней платформы v2 не пишет (его бот обслуживает v1): оплату
    // он увидит в продлённой подписке, а счёт — в панели оператора.
    notifyOwner: (botId, text) =>
      runInBackground(async () => {
        const { resolveTenant } = await import("@/core/tenant/resolve.server");
        const { servedByV2 } = await import("@/core/tenant/directory");
        const t = await resolveTenant({ by: "id", value: botId });
        if (!t || !servedByV2(t)) return;
        const { notifyOwner } = await import("./operator.server");
        await notifyOwner(botId, text);
      }, "apipay-notify-owner"),
  };
}

type Paid = Extract<ApipayEvent, { kind: "paid" }>;

/**
 * Оплата счёта по вебхуку. 2xx — «принято, повторять не надо»: повтор уже
 * учтённой оплаты и оплата, которую нельзя применить сама (её видит оператор
 * в журнале клиента и в учёте ошибок). 5xx — сбой у нас, ApiPay повторит.
 */
export async function settleApipayEvent(ev: ApipayEvent, deps: SettleDeps): Promise<SettleResult> {
  if (ev.kind === "ignored") return { status: 200, body: `ignored: ${ev.reason}` };
  const cfg = deps.config();
  const inv = await deps.readInvoice(ev.invoiceId);
  if (!inv) {
    console.error(`[apipay] оплата ${ev.apipayId} по неизвестному счёту ${ev.invoiceId}`);
    return { status: 200, body: "unknown invoice" };
  }
  const base = { invoice_id: inv.id, apipay_invoice_id: ev.apipayId, amount: ev.amount };
  // Песочная «оплата» денег не несёт: она закрывает только счёт тестового
  // магазина и только пока ApiPay в режиме песочницы. Без поля is_sandbox
  // оплата считается песочной — в боевом режиме такая не принимается.
  if (ev.sandbox !== false && (!cfg || cfg.live || inv.bot_id !== cfg.sandboxBotId)) {
    await deps.log(inv.bot_id, { action: "apipay_sandbox_ignored", ...base, sandbox: ev.sandbox });
    return { status: 200, body: "sandbox payment ignored" };
  }
  if (Math.abs(ev.amount - Number(inv.amount)) > 0.01 || inv.currency !== "KZT") {
    await deps.log(inv.bot_id, {
      action: "apipay_amount_mismatch",
      ...base,
      expected: Number(inv.amount),
      currency: inv.currency,
    });
    console.error(`[apipay] сумма ${ev.amount} ≠ счёту ${inv.amount} ${inv.currency} (${inv.id})`);
    return { status: 200, body: "amount mismatch" };
  }
  if (inv.status === "paid") return alreadyPaid(inv, ev, deps);
  if (inv.status !== "sent" && inv.status !== "proof_uploaded") return closed(inv, ev, deps);
  let r: { expiresAt: string | null };
  try {
    r = await deps.confirm(inv.id, inv.bot_id);
  } catch (e) {
    const { InvoiceAlreadyHandled } = await import("@/core/billing/invoice-state");
    if (!(e instanceof InvoiceAlreadyHandled)) throw e;
    // Счёт закрыли между чтением и захватом: оператор, чек или параллельный повтор.
    const now = await deps.readInvoice(inv.id);
    if (!now) throw e;
    return now.status === "paid" ? alreadyPaid(now, ev, deps) : closed(now, ev, deps);
  }
  await deps.log(inv.bot_id, { action: "apipay_paid", ...base });
  const until = r.expiresAt
    ? ` Подписка оплачена до ${new Date(r.expiresAt).toLocaleDateString("ru")}.`
    : "";
  await deps.notifyOwner(
    inv.bot_id,
    `Оплата ${Number(inv.amount)} ${inv.currency} через Kaspi получена, спасибо!${until}`,
  );
  return { status: 200, body: "ok" };
}

/**
 * Счёт уже оплачен. Повтор той же оплаты ApiPay — тихо 200. Другая оплата
 * (счёт закрыт чеком или оператором, а владелец заплатил ещё и по ссылке) —
 * деньги пришли дважды: в журнал и учёт ошибок, решает оператор.
 */
async function alreadyPaid(inv: InvoiceRow, ev: Paid, deps: SettleDeps): Promise<SettleResult> {
  if (await deps.hasPaidEvent(inv.bot_id, ev.apipayId))
    return { status: 200, body: "already paid" };
  await deps.log(inv.bot_id, {
    action: "apipay_paid_already_paid",
    invoice_id: inv.id,
    apipay_invoice_id: ev.apipayId,
    amount: ev.amount,
  });
  await deps.alert(inv.bot_id, `ApiPay: вторая оплата уже оплаченного счёта ${inv.id}`, {
    apipay_invoice_id: ev.apipayId,
    amount: ev.amount,
  });
  return { status: 200, body: "invoice already paid" };
}

/** Счёт отменён или отклонён, а ссылка осталась у владельца и он заплатил: решает оператор. */
async function closed(inv: InvoiceRow, ev: Paid, deps: SettleDeps): Promise<SettleResult> {
  await deps.log(inv.bot_id, {
    action: "apipay_paid_closed_invoice",
    invoice_id: inv.id,
    apipay_invoice_id: ev.apipayId,
    amount: ev.amount,
    was: inv.status,
  });
  await deps.alert(inv.bot_id, `ApiPay: оплата по счёту ${inv.id} в статусе ${inv.status}`, {
    apipay_invoice_id: ev.apipayId,
    amount: ev.amount,
  });
  return { status: 200, body: "invoice closed" };
}
