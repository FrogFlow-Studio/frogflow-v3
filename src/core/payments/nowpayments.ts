import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Оплата криптовалютой через NOWPayments (модуль `crypto`): у продавца свой
 * кабинет NOWPayments, ключ API и секрет IPN — в app_settings, видит их
 * только владелец. По заказу создаётся счёт-инвойс (покупатель выбирает
 * монету на странице NOWPayments); подтверждение приходит IPN на
 * /api/nowpayments/<bot_id>: подпись HMAC-SHA512 по телу с ключами по
 * алфавиту, затем сверка суммы и валюты заказа — и та же markPaidOnline,
 * что у Robokassa.
 */
export const NOWPAYMENTS_KEYS = [
  "crypto_enabled",
  "nowpayments_api_key",
  "nowpayments_ipn_secret",
] as const;

export type NowPaymentsConfig = { apiKey: string; ipnSecret: string };

export function nowpaymentsConfig(
  s: Record<string, string>,
  moduleOn: boolean,
): (NowPaymentsConfig & { ready: true }) | { ready: false } {
  const apiKey = s.nowpayments_api_key?.trim() ?? "";
  const ipnSecret = s.nowpayments_ipn_secret?.trim() ?? "";
  if (!moduleOn || s.crypto_enabled !== "true" || !apiKey || !ipnSecret) return { ready: false };
  return { ready: true, apiKey, ipnSecret };
}

/** JSON с ключами по алфавиту на всех уровнях — так NOWPayments считает подпись IPN. */
export function sortedJson(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sort)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.keys(x as Record<string, unknown>)
              .sort()
              .map((k) => [k, sort((x as Record<string, unknown>)[k])]),
          )
        : x;
  return JSON.stringify(sort(v));
}

export function ipnSignature(body: unknown, secret: string): string {
  return createHmac("sha512", secret).update(sortedJson(body)).digest("hex");
}

export function verifyIpn(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const expected = ipnSignature(body, secret);
  const got = signature.trim().toLowerCase();
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export type Ipn = {
  payment_id?: number | string;
  invoice_id?: number | string;
  payment_status?: string;
  order_id?: string;
  price_amount?: number | string;
  price_currency?: string;
};

export type IpnOutcome = "paid" | "partial" | "pending" | "failed" | "mismatch";

/**
 * Что значит уведомление для заказа. `finished` — деньги у продавца;
 * `confirmed` сети ещё не закрыт окончательно — ждём `finished`.
 * Сумма и валюта счёта должны совпасть с заказом: иначе это чужой счёт.
 */
export function ipnOutcome(ipn: Ipn, expected: { amount: number; currency: string }): IpnOutcome {
  const status = (ipn.payment_status ?? "").toLowerCase();
  if (status === "partially_paid") return "partial";
  if (["failed", "expired", "refunded"].includes(status)) return "failed";
  if (status !== "finished") return "pending";
  const amount = Number(ipn.price_amount);
  if (
    !Number.isFinite(amount) ||
    Math.abs(amount - expected.amount) > 0.01 ||
    (ipn.price_currency ?? "").toLowerCase() !== expected.currency.toLowerCase()
  )
    return "mismatch";
  return "paid";
}

type Fetch = typeof fetch;

/** Счёт-инвойс NOWPayments на сумму заказа в его валюте. */
export async function createInvoice(
  cfg: NowPaymentsConfig,
  p: {
    amount: number;
    currency: string;
    orderId: number;
    description: string;
    ipnUrl: string;
    successUrl: string;
    cancelUrl: string;
  },
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true; url: string; id: string } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        price_amount: Math.round(p.amount * 100) / 100,
        price_currency: p.currency.toLowerCase(),
        order_id: String(p.orderId),
        order_description: p.description.slice(0, 100),
        ipn_callback_url: p.ipnUrl,
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as {
      id?: string | number;
      invoice_url?: string;
      message?: string;
    };
    if (!res.ok || !j.invoice_url || !j.id)
      return { ok: false, error: j.message ?? `HTTP ${res.status}` };
    return { ok: true, url: j.invoice_url, id: String(j.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
