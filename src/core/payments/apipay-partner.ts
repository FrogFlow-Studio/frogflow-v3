/**
 * Партнёрский API ApiPay (apipay.kz/partner-api.md): FrogFlow заводит
 * продавцу организацию в ApiPay, привязывает кассира Kaspi Pay по SMS-коду,
 * выдаёт ссылку на анкету и счёт за тариф ApiPay, выпускает продавцу ключ
 * API с нашим вебхуком. Платежи по заказам дальше идут ключом продавца
 * (core/payments/kaspi-apipay). Партнёрский ключ X-Partner-Key — в
 * настройках платформы (operator_settings, зашифрован), в коде его нет.
 *
 * Здесь только HTTP: без базы и без окружения, fetch подставляется.
 */
import { PREVIEW_SEND_OFF, previewReadonly } from "@/lib/preview";

export const APIPAY_PARTNER_BASE_URL = "https://api.apipay.kz/api/partner";

const TIMEOUT_MS = 10_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type PartnerCall = { partnerKey: string; fetchImpl?: Fetch };

/** Ответ ApiPay: успех с телом или отказ с кодом (для текста оператору). */
export type PartnerResult<T> =
  { ok: true; body: T } | { ok: false; status: number; code: string | null; message: string };

/**
 * Сбой связи — отдельно от отказа: запрос мог дойти. Неидемпотентные вызовы
 * (выпуск ключа, счёт за тариф) после него не повторяются вслепую.
 */
export class PartnerUnreachable extends Error {}

async function call<T>(
  c: PartnerCall,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<PartnerResult<T>> {
  // Предпросмотр не заводит организаций и не выпускает ключей в ApiPay.
  if (previewReadonly())
    return { ok: false, status: 0, code: "preview", message: PREVIEW_SEND_OFF };
  let res: Response;
  try {
    res = await (c.fetchImpl ?? fetch)(`${APIPAY_PARTNER_BASE_URL}${path}`, {
      method,
      headers: {
        "X-Partner-Key": c.partnerKey,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new PartnerUnreachable(
      `ApiPay недоступен: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Неверный SMS-код приходит 200 с success: false — это отказ, а не успех.
  if (res.ok && json.success !== false) return { ok: true, body: json as T };
  const code = [json.error_code, json.error].find((v) => typeof v === "string") as
    string | undefined;
  return {
    ok: false,
    status: res.status,
    code: code ?? null,
    message: typeof json.message === "string" ? json.message.slice(0, 300) : "",
  };
}

export type OrgCard = {
  id: number | string;
  name?: string | null;
  status?: string;
  sandbox_mode?: boolean;
  is_test?: boolean;
  kyc_status?: string | null;
  kaspi_connected?: boolean;
  payment_status?: string | null;
};

const org = (id: string | number) => `/organizations/${encodeURIComponent(String(id))}`;

/** Организация продавца; повтор с тем же external_id (bot_id) вернёт ту же. */
export const createOrganization = (c: PartnerCall, p: { botId: string; name: string }) =>
  call<{ organization: OrgCard }>(c, "POST", "/organizations", {
    external_id: p.botId,
    name: p.name.slice(0, 255),
    business_relation: "customer",
  });

export const getOrganization = (c: PartnerCall, id: string | number) =>
  call<{ organization: OrgCard }>(c, "GET", org(id));

/** Кассир Kaspi Pay: шаг 1 — начать (процесс живёт 10 минут). */
export const kaspiAuthInit = (c: PartnerCall, id: string | number, force = false) =>
  call<{ process_id: string; process_status: string }>(
    c,
    "POST",
    `${org(id)}/kaspi-auth/init`,
    force ? { force: true } : {},
  );

/** Шаг 2 — номер кассира, 7XXXXXXXXXX: Kaspi пришлёт ему SMS. */
export const kaspiAuthSendPhone = (c: PartnerCall, id: string | number, phone: string) =>
  call<{ process_status: string }>(c, "POST", `${org(id)}/kaspi-auth/send-phone`, {
    cashier_phone: phone,
  });

/** Шаг 3 — код из SMS. */
export const kaspiAuthVerifyOtp = (c: PartnerCall, id: string | number, otp: string) =>
  call<{ organization?: OrgCard; process_status?: string }>(
    c,
    "POST",
    `${org(id)}/kaspi-auth/verify-otp`,
    { otp },
  );

export const kaspiAuthStatus = (c: PartnerCall, id: string | number) =>
  call<{ status: string; kaspi_connected?: boolean; expires_at?: string | null }>(
    c,
    "GET",
    `${org(id)}/kaspi-auth/status`,
  );

export type Kyc = {
  status: string;
  required_action?: string | null;
  can_submit?: boolean;
  comment?: string | null;
};

export const kycStatus = (c: PartnerCall, id: string | number) =>
  call<{ kyc: Kyc }>(c, "GET", `${org(id)}/kyc`);

/** Ссылка на анкету: показывается один раз, новая отзывает прежнюю. */
export const kycInvite = (c: PartnerCall, id: string | number) =>
  call<{ invite_url: string; expires_at?: string | null }>(c, "POST", `${org(id)}/kyc/invite`);

export type Tariff = {
  status: string;
  tier?: string | null;
  is_trial?: boolean;
  expires_at?: string | null;
  days_remaining?: number | null;
};

export const tariffStatus = (c: PartnerCall, id: string | number) =>
  call<{ tariff: Tariff }>(c, "GET", `${org(id)}/tariff`);

export const tariffPlans = (c: PartnerCall) =>
  call<{ tiers?: unknown[]; plans?: unknown[] }>(c, "GET", "/tariff-plans");

/**
 * Счёт за тариф ApiPay на Kaspi плательщика (8XXXXXXXXXX). Не повторять при
 * обрыве: второй вызов выставит второй счёт.
 */
export const tariffPay = (
  c: PartnerCall,
  id: string | number,
  p: { tierId: string | number; months: number; phone: string },
) =>
  call<{ payment: { id: number | string; amount?: number; status?: string } }>(
    c,
    "POST",
    `${org(id)}/tariff/pay`,
    { tier_id: p.tierId, period_months: p.months, phone: p.phone, set_billing_phone: true },
  );

/**
 * Ключ API продавца с нашим вебхуком. Не идемпотентно: повтор выпускает
 * новый ключ и сразу ломает прежний — при обрыве не повторять.
 */
export const issueApiKey = (c: PartnerCall, id: string | number, webhookUrl: string) =>
  call<{ key: string; webhook_secret: string; regenerated?: boolean }>(
    c,
    "POST",
    `${org(id)}/api-key`,
    { name: "FrogFlow", webhook_url: webhookUrl },
  );

/** Номер кассира для Kaspi: 7XXXXXXXXXX. Принимает +7, 8 и пробелы. */
export function cashierPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && (d[0] === "7" || d[0] === "8") ? d.slice(1) : d;
  return /^7\d{9}$/.test(ten) ? `7${ten}` : null;
}

/** Номер плательщика тарифа: 8XXXXXXXXXX. */
export function payerPhone(raw: string): string | null {
  const c = cashierPhone(raw);
  return c ? `8${c.slice(1)}` : null;
}

export type PlanOption = { id: string; label: string };

/** Тарифы ApiPay в любом из двух видов ответа (tiers или plans): id, название, цена в месяц. */
export function planOptions(raw: unknown): PlanOption[] {
  const r = (raw ?? {}) as { tiers?: unknown; plans?: unknown };
  const list = Array.isArray(r.tiers) ? r.tiers : Array.isArray(r.plans) ? r.plans : [];
  const out: PlanOption[] = [];
  for (const x of list) {
    const p = (x ?? {}) as Record<string, unknown>;
    const id = p.id ?? p.tier_id ?? p.slug;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const name = typeof p.name === "string" ? p.name : String(id);
    const price = p.monthly_price ?? p.price;
    out.push({
      id: String(id),
      label:
        typeof price === "number" || typeof price === "string" ? `${name} — ${price} ₸/мес` : name,
    });
  }
  return out;
}
