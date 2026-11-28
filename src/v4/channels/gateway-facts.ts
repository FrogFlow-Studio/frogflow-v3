/**
 * Факты оплаты для книги v4. Поле читается только там, где его кладёт шлюз.
 * Числовой номер заказа v3 сюда не попадает: заказ v4 — uuid.
 * Неуспешный статус — null, в книгу ничего не пишется.
 */

import type { Gateway } from "../core/platform";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type V4Paid = {
  orderId: string;
  amountMinor: number;
  currency: string;
  externalRef: string;
};

function uuid(v: unknown): string | null {
  return typeof v === "string" && UUID.test(v) ? v : null;
}

function minorFromMajor(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function paid(
  orderId: string | null,
  amountMinor: number | null,
  currency: unknown,
  ref: unknown,
): V4Paid | null {
  const externalRef = ref == null ? "" : String(ref);
  const cur = String(currency ?? "")
    .trim()
    .toUpperCase();
  if (!orderId || amountMinor == null || !/^[A-Z]{3}$/.test(cur) || !externalRef) return null;
  return { orderId, amountMinor, currency: cur, externalRef };
}

function stripe(payload: unknown): V4Paid | null {
  const ev = payload as {
    type?: string;
    data?: {
      object?: {
        object?: string;
        id?: string;
        payment_status?: string;
        amount_total?: number;
        currency?: string;
        payment_intent?: string | null;
        metadata?: { v4_order_id?: string } | null;
      };
    };
  };
  const s = ev.data?.object;
  if (!s || s.object !== "checkout.session") return null;
  if (
    ev.type !== "checkout.session.completed" &&
    ev.type !== "checkout.session.async_payment_succeeded"
  )
    return null;
  if (s.payment_status !== "paid") return null;
  const amount = typeof s.amount_total === "number" ? Math.round(s.amount_total) : null;
  return paid(
    uuid(s.metadata?.v4_order_id),
    amount && amount > 0 ? amount : null,
    s.currency,
    s.payment_intent || s.id,
  );
}

function prodamus(payload: unknown): V4Paid | null {
  const n = payload as {
    payment_status?: string;
    sum?: unknown;
    currency?: string;
    order_id?: unknown;
    order_num?: unknown;
    v4_order_id?: unknown;
  };
  if (String(n.payment_status ?? "") !== "success") return null;
  return paid(
    uuid(n.v4_order_id) ?? uuid(n.order_id),
    minorFromMajor(n.sum),
    n.currency,
    n.order_num ?? n.order_id,
  );
}

function kaspi(payload: unknown): V4Paid | null {
  const p = payload as { event?: string; invoice?: Record<string, unknown> };
  const inv = p.invoice ?? {};
  if (p.event !== "invoice.status_changed" || inv.status !== "paid") return null;
  const order = uuid(inv.v4_order_id) ?? uuid(inv.external_order_id);
  return paid(order, minorFromMajor(inv.amount), inv.currency ?? "KZT", inv.id);
}

function robokassa(payload: unknown): V4Paid | null {
  const n = payload as {
    v4_order_id?: unknown;
    amount_minor?: unknown;
    currency?: unknown;
    external_ref?: unknown;
  };
  const amount = typeof n.amount_minor === "number" ? Math.round(n.amount_minor) : null;
  return paid(
    uuid(n.v4_order_id),
    amount && amount > 0 ? amount : null,
    n.currency,
    n.external_ref,
  );
}

function nowpayments(payload: unknown): V4Paid | null {
  const n = payload as {
    payment_status?: string;
    order_id?: unknown;
    price_amount?: unknown;
    price_currency?: string;
    payment_id?: unknown;
  };
  if (String(n.payment_status ?? "").toLowerCase() !== "finished") return null;
  return paid(uuid(n.order_id), minorFromMajor(n.price_amount), n.price_currency, n.payment_id);
}

/** null — в книгу не писать: не заказ v4 или оплата ещё не прошла. */
export function v4PaidFacts(kind: Gateway, payload: unknown): V4Paid | null {
  if (!payload || typeof payload !== "object") return null;
  if (kind === "stripe") return stripe(payload);
  if (kind === "prodamus") return prodamus(payload);
  if (kind === "kaspi" || kind === "apipay") return kaspi(payload);
  if (kind === "nowpayments") return nowpayments(payload);
  if (kind === "robokassa") return robokassa(payload);
  return null;
}
