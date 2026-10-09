import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Продамус (payform.ru): своя платёжная форма у продавца из России
 * (самозанятый, ИП, ООО) — `https://<магазин>.payform.ru`, секретный ключ из
 * кабинета («Настройки → Ключ для подписи»). Ссылка на оплату собирается без
 * запроса к Продамусу: параметры формы и подпись `signature`. Оплату
 * подтверждает только уведомление на /api/prodamus/<bot_id>: заголовок `Sign`
 * (HMAC-SHA256 по телу), статус `success`, затем сверка суммы и валюты — и та
 * же markPaidOnline, что у Robokassa и Stripe.
 *
 * Касса в рублях, а цены в тенге: продавец задаёт курс (сколько тенге за
 * 1 ₽), и заказ в тенге оплачивается суммой в рублях, округлённой вверх до
 * рубля. Курс может поменяться между ссылкой и оплатой, поэтому сумму к
 * списанию ссылка несёт в `order_id` вместе с нашей подписью
 * (`<заказ>-<копейки>-<mac>`): уведомление сверяется с ней, а подправить
 * сумму в ссылке без секретного ключа нельзя.
 *
 * Подпись Продамуса — его библиотеки Hmac: все значения строками, ключи
 * отсортированы на каждом уровне, JSON как у PHP json_encode с
 * JSON_UNESCAPED_UNICODE (кириллица как есть, «/» экранирован), HMAC-SHA256
 * секретным ключом, hex.
 */
export const PRODAMUS_KEYS = [
  "prodamus_enabled",
  "prodamus_form_url",
  "prodamus_secret_key",
  "prodamus_currency",
  "prodamus_rate",
] as const;

/** Валюта цен, которую пересчитывает курс: тенге. */
export const PRODAMUS_RATE_FROM = "KZT";

/** Валюты, которые принимает форма Продамуса (параметр `currency`). */
export const PRODAMUS_CURRENCIES = ["RUB", "KZT", "USD", "EUR"] as const;
export type ProdamusCurrency = (typeof PRODAMUS_CURRENCIES)[number];

export type ProdamusConfig = {
  /** https://<магазин>.payform.ru без пути и хвостового «/». */
  formUrl: string;
  secretKey: string;
  /** Валюта кассы: кнопка только у заказов в ней, иначе 1500 ₸ списались бы как 1500 ₽. */
  currency: ProdamusCurrency;
  /** Сколько тенге за 1 единицу валюты кассы; null — без пересчёта. */
  rate: number | null;
};

/** Адрес формы из настройки: https://*.payform.ru, *.proeducation.kz или свой домен формы. */
export function normalizeFormUrl(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v.includes("://") ? v : `https://${v}`);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return `https://${u.hostname}`;
  } catch {
    return null;
  }
}

/** Форма считает только в тенге: казахстанский домен Продамуса. */
export function tengeOnlyForm(formUrl: string): boolean {
  return new URL(formUrl).hostname.endsWith(".kz");
}

export function prodamusConfig(
  s: Record<string, string>,
  moduleOn: boolean,
): (ProdamusConfig & { ready: true }) | { ready: false } {
  const formUrl = normalizeFormUrl(s.prodamus_form_url);
  const secretKey = s.prodamus_secret_key?.trim() ?? "";
  if (!moduleOn || s.prodamus_enabled !== "true" || !formUrl || !secretKey) return { ready: false };
  const c = (s.prodamus_currency ?? "").toUpperCase();
  // Форма Продамуса для Казахстана (*.kz, например proeducation.kz) не берёт параметр
  // currency и выставляет сумму в тенге: 1148 «рублей» за заказ на 6000 ₸ ушли бы как 1148 ₸.
  const currency = tengeOnlyForm(formUrl)
    ? PRODAMUS_RATE_FROM
    : (PRODAMUS_CURRENCIES as readonly string[]).includes(c)
      ? (c as ProdamusCurrency)
      : "RUB";
  const rate = Number(String(s.prodamus_rate ?? "").replace(",", "."));
  return {
    ready: true,
    formUrl,
    secretKey,
    currency,
    rate: Number.isFinite(rate) && rate > 0 && currency !== PRODAMUS_RATE_FROM ? rate : null,
  };
}

/**
 * Сколько списать Продамусом за сумму заказа: в валюте кассы как есть, заказ
 * в тенге при заданном курсе — в валюте кассы, округлено вверх до целой.
 * null — эту валюту касса не примет.
 */
export function prodamusCharge(
  cfg: ProdamusConfig,
  amount: number,
  currency: string | null | undefined,
): { amount: number; currency: ProdamusCurrency } | null {
  const c = (currency ?? "").toUpperCase();
  if (c === cfg.currency) return { amount: Math.round(amount * 100) / 100, currency: cfg.currency };
  if (c === PRODAMUS_RATE_FROM && cfg.rate)
    return { amount: Math.ceil(amount / cfg.rate - 1e-9), currency: cfg.currency };
  return null;
}

export function prodamusAccepts(cfg: ProdamusConfig, currency: string | null | undefined): boolean {
  return prodamusCharge(cfg, 1, currency) !== null;
}

/** Метка суммы в order_id: первые 16 hex HMAC по заказу, копейкам и валюте. */
function chargeMac(secret: string, orderId: number, minor: number, currency: string): string {
  return createHmac("sha256", secret)
    .update(`frogflow:${orderId}:${minor}:${currency}`)
    .digest("hex")
    .slice(0, 16);
}

/** order_id для формы: заказ, сумма к списанию в копейках и наша подпись. */
export function chargeRef(
  cfg: ProdamusConfig,
  orderId: number,
  charge: { amount: number; currency: string },
): string {
  const minor = Math.round(charge.amount * 100);
  return `${orderId}-${minor}-${chargeMac(cfg.secretKey, orderId, minor, charge.currency)}`;
}

/**
 * Из order_num уведомления: наш заказ и сумма, которую ему выставили. null —
 * чужой формат или подпись не сошлась (номер не наш или сумму подменили).
 */
export function parseChargeRef(
  cfg: ProdamusConfig,
  ref: unknown,
): { orderId: number; amount: number; currency: ProdamusCurrency } | null {
  const m = /^(\d+)-(\d+)-([0-9a-f]{16})$/.exec(String(ref ?? "").trim());
  if (!m) return null;
  const orderId = Number(m[1]);
  const minor = Number(m[2]);
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !Number.isSafeInteger(minor)) return null;
  const expected = Buffer.from(chargeMac(cfg.secretKey, orderId, minor, cfg.currency));
  const got = Buffer.from(m[3]!);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  return { orderId, amount: minor / 100, currency: cfg.currency };
}

type Json = string | Json[] | { [k: string]: Json };

/** Значения строками, ключи по порядку на каждом уровне; null/undefined выпадают. */
function strValAndSort(v: unknown): Json {
  if (Array.isArray(v)) return v.map(strValAndSort);
  if (v !== null && typeof v === "object") {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === undefined || x === null) continue;
      out[k] = strValAndSort(x);
    }
    return out;
  }
  return v === undefined || v === null ? "" : String(v);
}

const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");

/** Подпись Продамуса (см. комментарий модуля). */
export function prodamusSign(data: unknown, secret: string): string {
  const json = JSON.stringify(strValAndSort(data))
    .replace(/\//g, "\\/")
    // PHP json_encode экранирует разделители строк и при JSON_UNESCAPED_UNICODE.
    .replace(LS, "\\u2028")
    .replace(PS, "\\u2029");
  return createHmac("sha256", secret).update(json).digest("hex");
}

export function verifyProdamusSign(data: unknown, sign: string | null, secret: string): boolean {
  if (!sign) return false;
  const expected = Buffer.from(prodamusSign(data, secret));
  const got = Buffer.from(sign.trim().toLowerCase());
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Тело уведомления (form-urlencoded в стиле PHP: `products[0][name]=…`) —
 * в объект, как его видит $_POST: вложенные ключи — объекты, подряд идущие
 * номера 0..n-1 — массив.
 */
export function parsePhpForm(body: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const m = /^([^[\]]+)((?:\[[^[\]]*\])*)$/.exec(key);
    const path = m ? [m[1]!, ...[...m[2]!.matchAll(/\[([^[\]]*)\]/g)].map((x) => x[1]!)] : [key];
    let node = root;
    for (let i = 0; i < path.length - 1; i++) {
      let seg = path[i]!;
      if (seg === "") seg = String(Object.keys(node).length);
      const next = node[seg];
      if (next === null || typeof next !== "object") node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    let last = path[path.length - 1]!;
    if (last === "") last = String(Object.keys(node).length);
    node[last] = value;
  }
  return listsToArrays(root) as Record<string, unknown>;
}

function listsToArrays(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  for (const k of keys) o[k] = listsToArrays(o[k]);
  if (keys.length > 0 && keys.every((k, i) => k === String(i))) return keys.map((k) => o[k]);
  return o;
}

/** Строка запроса в стиле PHP http_build_query: products[0][name]=…. */
function phpQuery(data: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(`${prefix}[${k}]`, x);
      return;
    }
    parts.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(data)) walk(k, v);
  return parts.join("&");
}

/** Сумма для формы: до копеек, без хвостовых нулей не обрезаем — «1500.00». */
const money = (n: number) => n.toFixed(2);

/**
 * Ссылка на форму Продамуса на сумму к списанию (уже в валюте кассы, см.
 * prodamusCharge). `order_id` — chargeRef (в уведомлении вернётся как
 * `order_num`); одна позиция «Заказ #N» на всю сумму, оплатить ссылку можно
 * один раз.
 */
export function buildProdamusLink(
  cfg: ProdamusConfig,
  p: {
    /** Сумма в валюте кассы. */
    amount: number;
    orderId: number;
    description: string;
    notifyUrl: string;
    successUrl: string;
    returnUrl: string;
    email?: string | null;
  },
): string {
  const data: Record<string, unknown> = {
    do: "pay",
    order_id: chargeRef(cfg, p.orderId, { amount: p.amount, currency: cfg.currency }),
    products: [
      {
        name: p.description.slice(0, 250),
        price: money(p.amount),
        quantity: "1",
        sku: String(p.orderId),
      },
    ],
    currency: cfg.currency.toLowerCase(),
    payments_limit: "1",
    urlNotification: p.notifyUrl,
    urlSuccess: p.successUrl,
    urlReturn: p.returnUrl,
    ...(p.email ? { customer_email: p.email } : {}),
  };
  const signature = prodamusSign(data, cfg.secretKey);
  return `${cfg.formUrl}/?${phpQuery({ ...data, signature })}`;
}

export type ProdamusOutcome = "paid" | "mismatch" | "ignore";

/**
 * Что значит уведомление для заказа: оплата только при `success`, и сумма
 * должна совпасть с выставленной (ссылку покупатель может поправить руками).
 * `sum` Продамус шлёт в валюте формы, а `currency` — валюта карты: форма в
 * тенге, оплаченная картой РФ, приходит как sum=150.00, currency=rub
 * (Копилка русоведа 09.10, платёж 511523 — покупатель списал 41,98 ₽).
 * Поэтому валюта на решение не влияет; её видно в журнале заказа.
 */
export function prodamusOutcome(
  n: Record<string, unknown>,
  expected: { amount: number; currency: string },
): ProdamusOutcome {
  if (String(n.payment_status ?? "") !== "success") return "ignore";
  const sum = Number(String(n.sum ?? "").replace(",", "."));
  if (!Number.isFinite(sum) || Math.abs(sum - expected.amount) > 0.005) return "mismatch";
  return "paid";
}

/** Валюта карты, если она не валюта формы (оплата картой РФ в форме в тенге); иначе null. */
export function prodamusCardCurrency(
  n: Record<string, unknown>,
  formCurrency: string,
): string | null {
  const c = String(n.currency ?? "")
    .trim()
    .toUpperCase();
  return c && c !== formCurrency.toUpperCase() ? c : null;
}
