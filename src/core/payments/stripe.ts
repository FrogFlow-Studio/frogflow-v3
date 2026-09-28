import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Оплата иностранной картой через Stripe Checkout (модуль `stripe`): у
 * продавца свой аккаунт Stripe, секретный ключ и секрет вебхука — в
 * app_settings, видит их только владелец. По заказу создаётся сессия
 * Checkout на сумму к оплате в валюте заказа; способы оплаты Stripe берёт
 * из кабинета продавца (включит там PayPal — появится и PayPal). Оплату
 * подтверждает только вебхук /api/stripe/<bot_id>: подпись Stripe-Signature
 * (HMAC-SHA256 по «t.тело»), затем сверка суммы и валюты — и та же
 * markPaidOnline, что у Robokassa и NOWPayments.
 */
export const STRIPE_KEYS = [
  "stripe_enabled",
  "stripe_secret_key",
  "stripe_webhook_secret",
] as const;

export type StripeConfig = { secretKey: string; webhookSecret: string };

export function stripeConfig(
  s: Record<string, string>,
  moduleOn: boolean,
): (StripeConfig & { ready: true }) | { ready: false } {
  const secretKey = s.stripe_secret_key?.trim() ?? "";
  const webhookSecret = s.stripe_webhook_secret?.trim() ?? "";
  if (!moduleOn || s.stripe_enabled !== "true" || !secretKey || !webhookSecret)
    return { ready: false };
  return { ready: true, secretKey, webhookSecret };
}

/** Валюты без копеек у Stripe: сумма передаётся целыми единицами, а не сотыми. */
const ZERO_DECIMAL = new Set(
  "bif clp djf gnf jpy kmf krw mga pyg rwf ugx vnd vuv xaf xof xpf".split(" "),
);

/** Сумма в минимальных единицах валюты, как её ждёт и присылает Stripe. */
export function toMinor(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(amount) : Math.round(amount * 100);
}

/** Окно свежести подписи, как у библиотек Stripe: старое событие — повтор. */
export const SIGNATURE_TOLERANCE_SEC = 300;

export function stripeSignature(rawBody: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Заголовок Stripe-Signature: `t=<секунды>,v1=<hex>[,v1=...]`. */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  let t = NaN;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((x) => x?.trim() ?? "");
    if (k === "t") t = Number(v);
    else if (k === "v1" && v) v1.push(v.toLowerCase());
  }
  if (!Number.isInteger(t) || v1.length === 0) return false;
  if (Math.abs(nowSec - t) > SIGNATURE_TOLERANCE_SEC) return false;
  const expected = Buffer.from(stripeSignature(rawBody, t, secret));
  return v1.some(
    (sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), expected),
  );
}

export type StripeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      object?: string;
      payment_status?: string;
      amount_total?: number;
      currency?: string;
      client_reference_id?: string | null;
      payment_intent?: string | null;
      metadata?: Record<string, string> | null;
    };
  };
};

export type StripeOutcome = "paid" | "pending" | "failed" | "mismatch" | "ignore";

/**
 * Что значит событие для заказа. Сессия Checkout оплачена сразу
 * (`checkout.session.completed` с `paid`) или позже, отложенным способом
 * (`async_payment_succeeded`); `async_payment_failed` — отказ. Сумма и
 * валюта сессии должны совпасть с заказом: иначе это чужой платёж.
 */
export function stripeOutcome(
  ev: StripeEvent,
  expected: { amount: number; currency: string },
): StripeOutcome {
  const s = ev.data?.object;
  if (!s || s.object !== "checkout.session") return "ignore";
  if (ev.type === "checkout.session.async_payment_failed") return "failed";
  if (
    ev.type !== "checkout.session.completed" &&
    ev.type !== "checkout.session.async_payment_succeeded"
  )
    return "ignore";
  if (s.payment_status !== "paid") return "pending";
  if (
    s.amount_total !== toMinor(expected.amount, expected.currency) ||
    (s.currency ?? "").toLowerCase() !== expected.currency.toLowerCase()
  )
    return "mismatch";
  return "paid";
}

/** Номер заказа из сессии: client_reference_id, запасной — metadata.order_id. */
export function sessionOrderId(ev: StripeEvent): number | null {
  const s = ev.data?.object;
  const n = Number(s?.client_reference_id ?? s?.metadata?.order_id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type Fetch = typeof fetch;

/** Сессия Stripe Checkout на сумму заказа в его валюте. */
export async function createCheckoutSession(
  cfg: StripeConfig,
  p: {
    amount: number;
    currency: string;
    orderId: number;
    botId: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
    email?: string | null;
  },
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true; url: string; id: string } | { ok: false; error: string }> {
  const form = new URLSearchParams({
    mode: "payment",
    client_reference_id: String(p.orderId),
    "metadata[order_id]": String(p.orderId),
    "metadata[bot_id]": p.botId,
    "payment_intent_data[metadata][order_id]": String(p.orderId),
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": p.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(toMinor(p.amount, p.currency)),
    "line_items[0][price_data][product_data][name]": p.description.slice(0, 250),
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
  });
  if (p.email) form.set("customer_email", p.email);
  try {
    const res = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!res.ok || !j.url || !j.id)
      return { ok: false, error: j.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, url: j.url, id: j.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
