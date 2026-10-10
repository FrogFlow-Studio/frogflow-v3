import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Оплата заказа через Kaspi (модуль `kaspi_pay`) — ApiPay продавца: у
 * продавца своя организация в ApiPay со своим кассиром Kaspi Pay, ключ API и
 * секрет вебхука — в app_settings, видит их только владелец. Деньги идут
 * прямо на Kaspi продавца, ApiPay только выставляет ссылку и сообщает об
 * оплате. По заказу создаётся одноразовая ссылка (`POST /invoices/qr`):
 * покупатель жмёт «Оплатить в Kaspi», сумма уже подставлена. Подтверждение —
 * вебхук /api/kaspi/<bot_id>: подпись HMAC-SHA256 по телу, затем сверка суммы
 * и та же markPaidOnline, что у Robokassa и NOWPayments.
 *
 * Счета подписки платформы — отдельный ApiPay платформы
 * (core/billing/pay/apipay.ts) со своим ключом и своим вебхуком.
 */
export const KASPI_APIPAY_KEYS = [
  "kaspi_apipay_enabled",
  "kaspi_apipay_api_key",
  "kaspi_apipay_webhook_secret",
  "kaspi_apipay_test_mode",
] as const;

export const KASPI_APIPAY_BASE_URL = "https://api.apipay.kz/api/v1";

/** Kaspi принимает только тенге. */
export const KASPI_CURRENCY = "KZT";

export type KaspiApipayConfig = {
  apiKey: string;
  webhookSecret: string;
  /** Песочница ApiPay: ссылки ненастоящие, песочные «оплаты» засчитываются. */
  testMode: boolean;
};

export function kaspiApipayConfig(
  s: Record<string, string>,
  moduleOn: boolean,
): (KaspiApipayConfig & { ready: true }) | { ready: false } {
  const apiKey = s.kaspi_apipay_api_key?.trim() ?? "";
  const webhookSecret = s.kaspi_apipay_webhook_secret?.trim() ?? "";
  if (!moduleOn || s.kaspi_apipay_enabled !== "true" || !apiKey || !webhookSecret)
    return { ready: false };
  return { ready: true, apiKey, webhookSecret, testMode: s.kaspi_apipay_test_mode === "true" };
}

export function kaspiAccepts(currency: string | null | undefined): boolean {
  return (currency ?? "").toUpperCase() === KASPI_CURRENCY;
}

const ORDER_PREFIX = "ff-ord:";

/** Заказ в ApiPay узнаётся по `external_order_id` = `ff-ord:<id заказа>`. */
export const kaspiOrderRef = (orderId: number) => `${ORDER_PREFIX}${orderId}`;

export function parseKaspiOrderRef(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.startsWith(ORDER_PREFIX)) return null;
  const tail = raw.slice(ORDER_PREFIX.length);
  if (!/^[1-9]\d{0,14}$/.test(tail)) return null;
  return Number(tail);
}

/** Kaspi показывает покупателю только первые 60 символов описания. */
const DESCRIPTION_MAX = 60;
const TIMEOUT_MS = 8000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

export type KaspiLink = { ok: true; url: string; id: string | null } | { ok: false; error: string };

/**
 * Одноразовая ссылка на оплату заказа. Повтор с той же суммой (вторая кнопка,
 * двойной клик) возвращает уже выставленную ссылку, а не вторую: ключ
 * идемпотентности — заказ и сумма.
 */
export async function createKaspiLink(
  cfg: Pick<KaspiApipayConfig, "apiKey">,
  p: { orderId: number; amount: number; description: string },
  fetchImpl: Fetch = fetch,
): Promise<KaspiLink> {
  const amount = Math.round(p.amount * 100) / 100;
  const description =
    p.description.length > DESCRIPTION_MAX
      ? `${p.description.slice(0, DESCRIPTION_MAX - 1)}…`
      : p.description;
  let res: Response;
  try {
    res = await fetchImpl(`${KASPI_APIPAY_BASE_URL}/invoices/qr`, {
      method: "POST",
      headers: {
        "X-API-Key": cfg.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        static: true,
        single_use: true,
        amount,
        description,
        external_order_id: kaspiOrderRef(p.orderId),
        external_order_id_idempotency: `${kaspiOrderRef(p.orderId)}:${amount}`,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: `ApiPay недоступен: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // 409 idempotency_conflict — ссылка на этот заказ уже есть, она в теле ответа.
  const ok = res.ok || (res.status === 409 && body.error_code === "idempotency_conflict");
  if (!ok) {
    const code = [body.error_code, body.error].find((v) => typeof v === "string");
    return { ok: false, error: `ApiPay ответил ${res.status}${code ? ` (${code})` : ""}` };
  }
  const url = httpsUrl(body.payment_url);
  if (!url) return { ok: false, error: "ApiPay не вернул ссылку на оплату" };
  const id = body.static_qr_id;
  return {
    ok: true,
    url,
    id: typeof id === "number" || typeof id === "string" ? String(id) : null,
  };
}

/**
 * Подпись вебхука: `X-Webhook-Signature: sha256=<hex HMAC-SHA256 сырого тела>`.
 * Считается по байтам тела как пришли; hex сравнивается без учёта регистра.
 */
export function verifyKaspiSignature(
  rawBody: Uint8Array | string,
  header: string | null,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`,
    "utf8",
  );
  const received = Buffer.from(header.trim().toLowerCase(), "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export type KaspiEvent =
  | {
      kind: "paid";
      /** id счёта ApiPay (не наш) — номер платежа в журнале заказа. */
      apipayId: string;
      orderId: number;
      amount: number;
      /** is_sandbox из вебхука; null — поля нет (такая оплата считается песочной). */
      sandbox: boolean | null;
    }
  | { kind: "refunded"; apipayId: string; orderId: number; full: boolean }
  | { kind: "ignored"; reason: string };

/**
 * Разбор вебхука ApiPay продавца. Оплата — `invoice.status_changed` со
 * статусом `paid`; возврат — `invoice.refunded` (статуса refunded у ApiPay
 * нет, полный возврат — флаг is_fully_refunded). Остальное — пропуск с
 * причиной для журнала.
 */
export function parseKaspiWebhook(payload: unknown): KaspiEvent {
  const p = (payload ?? {}) as { event?: unknown; invoice?: Record<string, unknown> };
  const inv = p.invoice ?? {};
  const orderId = parseKaspiOrderRef(inv.external_order_id);
  const apipayId = String(inv.id ?? "");
  if (p.event === "invoice.refunded") {
    if (!orderId) return { kind: "ignored", reason: "не наш заказ" };
    return { kind: "refunded", apipayId, orderId, full: inv.is_fully_refunded === true };
  }
  if (p.event !== "invoice.status_changed") return { kind: "ignored", reason: `event ${p.event}` };
  if (inv.status !== "paid") return { kind: "ignored", reason: `status ${inv.status}` };
  if (!orderId) return { kind: "ignored", reason: "не наш заказ" };
  const amount = Number(inv.amount);
  if (!Number.isFinite(amount)) return { kind: "ignored", reason: "нет суммы" };
  return {
    kind: "paid",
    apipayId,
    orderId,
    amount,
    sandbox: typeof inv.is_sandbox === "boolean" ? inv.is_sandbox : null,
  };
}

/**
 * Можно ли засчитать оплату: песочная «оплата» денег не несёт и закрывает
 * заказ только в тестовом режиме продавца; сумма — ровно к оплате, в тенге.
 */
export function kaspiOutcome(
  ev: Extract<KaspiEvent, { kind: "paid" }>,
  cfg: Pick<KaspiApipayConfig, "testMode">,
  expected: { amount: number; currency: string },
): "paid" | "sandbox" | "mismatch" {
  if (ev.sandbox !== false && !cfg.testMode) return "sandbox";
  if (!kaspiAccepts(expected.currency) || Math.abs(ev.amount - expected.amount) > 0.01)
    return "mismatch";
  return "paid";
}
