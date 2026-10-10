import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { decryptSecret, encryptSecret } from "@/core/secrets/vault";
import {
  cashierPhone,
  createOrganization,
  getOrganization,
  issueApiKey,
  kaspiAuthInit,
  kaspiAuthSendPhone,
  kaspiAuthStatus,
  kaspiAuthVerifyOtp,
  kycInvite,
  kycStatus,
  payerPhone,
  planOptions,
  type PlanOption,
  tariffPay,
  tariffPlans,
  tariffStatus,
  type Kyc,
  type OrgCard,
  type PartnerCall,
  type PartnerResult,
  type Tariff,
} from "@/core/payments/apipay-partner";
import { PartnerUnreachable } from "@/core/payments/apipay-partner";
import { getSettingsStrict, setSetting } from "@/core/settings/settings";
import { servedByV2 } from "@/core/tenant/directory";
import { patchTenantSettings, requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { logEvent } from "./client-log.server";

/**
 * Подключение продавца к оплате Kaspi через партнёрский API ApiPay — из
 * карточки клиента у оператора: организация, кассир Kaspi Pay по SMS-коду,
 * анкета, тариф ApiPay и выпуск ключа с вебхуком /api/kaspi/<bot_id>. Ключ
 * и секрет вебхука ложатся в настройки продавца (kaspi_apipay_*), дальше
 * оплату ведёт core/payments/kaspi-apipay.
 *
 * Партнёрский ключ — в operator_settings, зашифрован SECRETS_KEY.
 */
const PARTNER_KEY = "apipay_partner_key";

const secretKey = () => env().SECRETS_KEY;

/** Отказ оператору: обычный Error экран показывает как есть (lib/server-failure). */
const refuse = (text: string) => new Error(text);

async function readPartnerKey(): Promise<string | null> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", PARTNER_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`[apipay] партнёрский ключ не прочитан: ${error.message}`);
  return data?.value ? decryptSecret(data.value, secretKey()) : null;
}

export async function partnerKeyConfigured(): Promise<boolean> {
  return Boolean(await readPartnerKey());
}

/** Сохранить или стереть (пустая строка) партнёрский ключ ApiPay. */
export async function setPartnerKey(value: string): Promise<void> {
  const v = value.trim();
  const db = serviceDb();
  if (!v) {
    const { error } = await db.from("operator_settings").delete().eq("key", PARTNER_KEY);
    if (error) throw serverFailure(`[apipay] партнёрский ключ не стёрт: ${error.message}`);
    return;
  }
  const stored = encryptSecret(v, secretKey());
  const { data, error: readErr } = await db
    .from("operator_settings")
    .select("key")
    .eq("key", PARTNER_KEY)
    .maybeSingle();
  if (readErr) throw serverFailure(`[apipay] партнёрский ключ не прочитан: ${readErr.message}`);
  const { error } = data
    ? await db.from("operator_settings").update({ value: stored }).eq("key", PARTNER_KEY)
    : await db.from("operator_settings").insert({ key: PARTNER_KEY, value: stored });
  if (error) throw serverFailure(`[apipay] партнёрский ключ не сохранён: ${error.message}`);
}

async function partner(): Promise<PartnerCall> {
  const key = await readPartnerKey();
  if (!key)
    throw refuse("Партнёрский ключ ApiPay не задан: «Настройки платформы» → «ApiPay (Kaspi)».");
  return { partnerKey: key };
}

/** Отказ ApiPay — текстом оператору; код ошибки ApiPay в скобках. */
const REFUSALS: Record<string, string> = {
  invalid_phone: "номер не в формате 7XXXXXXXXXX",
  not_cashier: "у этого номера нет роли «Кассир» в Kaspi Pay",
  not_registered: "номер не зарегистрирован в Kaspi Pay",
  no_process: "привязка не начата или истекла — отправьте номер ещё раз",
  context_expired: "прошло больше 10 минут — отправьте номер ещё раз",
  sms_failed: "Kaspi не отправил SMS — попробуйте позже",
  kaspi_busy: "Kaspi занят — попробуйте через минуту",
  cashier_unavailable: "кассир недоступен",
  rate_limited: "превышен дневной лимит попыток",
  invalid_otp: "неверный код из SMS",
  organization_in_use: "организация уже используется",
};

function unwrap<T>(r: PartnerResult<T>, what: string): T {
  if (r.ok) return r.body;
  const reason = (r.code && REFUSALS[r.code]) || r.message || `ответ ${r.status}`;
  throw refuse(`ApiPay: ${what} — ${reason}${r.code ? ` (${r.code})` : ""}.`);
}

async function client(botId: string) {
  const tenant = await requireTenant({ by: "id", value: botId });
  // Клиента прежней платформы v2 не обслуживает: вебхук /api/kaspi его не примет.
  if (!servedByV2(tenant)) throw refuse("Клиента пока обслуживает v1 — подключать Kaspi рано.");
  return { tenant, ctx: tenantContext(tenant) };
}

function orgIdOf(tenant: { settings: { apipay?: { org_id?: string } } }): string {
  const id = tenant.settings.apipay?.org_id;
  if (!id) throw refuse("Сначала создайте организацию в ApiPay.");
  return id;
}

export type ApipayClientState = {
  /** Клиента обслуживает v2: иначе подключать рано, ApiPay не спрашиваем. */
  servedByV2: boolean;
  /** Модуль «Kaspi Pay» включён у клиента: без него кнопки у покупателя нет. */
  moduleOn: boolean;
  partner: boolean;
  orgId: string | null;
  org: OrgCard | null;
  cashier: { status: string; connected: boolean } | null;
  kyc: Kyc | null;
  tariff: Tariff | null;
  /** У продавца сохранены ключ и секрет вебхука. */
  keyIssued: boolean;
  /** Ошибка чтения состояния из ApiPay (связь, ключ) — карточка показывает её. */
  error: string | null;
};

/** Что сейчас у продавца в ApiPay: читается при открытии карточки. */
export async function apipayClientState(botId: string): Promise<ApipayClientState> {
  const tenant = await requireTenant({ by: "id", value: botId });
  const orgId = tenant.settings.apipay?.org_id ?? null;
  const s = await getSettingsStrict(tenantContext(tenant), [
    "kaspi_apipay_api_key",
    "kaspi_apipay_webhook_secret",
  ]);
  const base: ApipayClientState = {
    servedByV2: servedByV2(tenant),
    moduleOn: tenant.modules.kaspi_pay === true,
    partner: false,
    orgId,
    org: null,
    cashier: null,
    kyc: null,
    tariff: null,
    keyIssued: Boolean(s.kaspi_apipay_api_key?.trim() && s.kaspi_apipay_webhook_secret?.trim()),
    error: null,
  };
  const key = await readPartnerKey();
  if (!key) return base;
  if (!base.servedByV2) return { ...base, partner: true };
  const c = { partnerKey: key };
  if (!orgId) return { ...base, partner: true };
  try {
    const [org, cashier, kyc, tariff] = await Promise.all([
      getOrganization(c, orgId),
      kaspiAuthStatus(c, orgId),
      kycStatus(c, orgId),
      tariffStatus(c, orgId),
    ]);
    return {
      ...base,
      partner: true,
      org: org.ok ? org.body.organization : null,
      cashier: cashier.ok
        ? { status: cashier.body.status, connected: cashier.body.kaspi_connected === true }
        : null,
      kyc: kyc.ok ? kyc.body.kyc : null,
      tariff: tariff.ok ? tariff.body.tariff : null,
      error: org.ok ? null : `ApiPay: организация не прочитана (${org.code ?? org.status})`,
    };
  } catch (e) {
    return { ...base, partner: true, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Организация продавца; повтор вернёт ту же (external_id = bot_id). */
export async function apipayCreateOrg(botId: string, actor: string): Promise<string> {
  const { tenant } = await client(botId);
  if (tenant.settings.apipay?.org_id) return tenant.settings.apipay.org_id;
  const body = unwrap(
    await createOrganization(await partner(), { botId, name: tenant.name }),
    "организация не создана",
  );
  const id = String(body.organization.id);
  await patchTenantSettings(botId, { apipay: { org_id: id } });
  await logEvent(botId, "payment", { action: "apipay_org_created", org_id: id }, actor);
  return id;
}

/** Номер кассира: начать привязку и попросить Kaspi прислать SMS. */
export async function apipaySendCashierPhone(
  botId: string,
  rawPhone: string,
  actor: string,
): Promise<void> {
  const { tenant } = await client(botId);
  const orgId = orgIdOf(tenant);
  const phone = cashierPhone(rawPhone);
  if (!phone) throw refuse("Номер кассира — в формате +7 7XX XXX XX XX.");
  const c = await partner();
  unwrap(await kaspiAuthInit(c, orgId, true), "привязка не начата");
  unwrap(await kaspiAuthSendPhone(c, orgId, phone), "SMS не отправлено");
  await logEvent(
    botId,
    "payment",
    { action: "apipay_cashier_sms", phone: `${phone.slice(0, 4)}…${phone.slice(-2)}` },
    actor,
  );
}

export async function apipayVerifyCashier(botId: string, otp: string, actor: string) {
  const { tenant } = await client(botId);
  const code = otp.replace(/\D/g, "");
  if (!/^\d{4,6}$/.test(code)) throw refuse("Код из SMS — 4–6 цифр.");
  unwrap(await kaspiAuthVerifyOtp(await partner(), orgIdOf(tenant), code), "кассир не привязан");
  await logEvent(botId, "payment", { action: "apipay_cashier_connected" }, actor);
}

/**
 * Ссылка на анкету ApiPay для продавца. Показывается один раз; новая
 * отзывает прежнюю. Заполнить анкету за продавца нельзя.
 */
export async function apipayKycLink(botId: string, actor: string): Promise<string> {
  const { tenant } = await client(botId);
  const body = unwrap(await kycInvite(await partner(), orgIdOf(tenant)), "ссылка не выдана");
  await logEvent(botId, "payment", { action: "apipay_kyc_invite" }, actor);
  return body.invite_url;
}

export async function apipayPlans(): Promise<PlanOption[]> {
  return planOptions(unwrap(await tariffPlans(await partner()), "тарифы не прочитаны"));
}

/**
 * Один неидемпотентный вызов на продавца за раз: двойной клик выставил бы
 * второй счёт или выпустил второй ключ. Отметка — строка operator_settings,
 * вставка второй падает на ключе; зависшая (упала функция) снимается через
 * LOCK_STALE_MS условным удалением по её же значению.
 */
const LOCK_STALE_MS = 2 * 60_000;
const lockKey = (botId: string) => `apipay_lock:${botId}`;

export async function withApipayLock<T>(
  botId: string,
  fn: () => Promise<T>,
  now = Date.now,
): Promise<T> {
  const db = serviceDb();
  const key = lockKey(botId);
  const take = () => db.from("operator_settings").insert({ key, value: String(now()) });
  let { error } = await take();
  if (error) {
    const { data, error: readErr } = await db
      .from("operator_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (readErr) throw serverFailure(`[apipay] отметка не прочитана: ${readErr.message}`);
    const since = Number(data?.value);
    if (data && Number.isFinite(since) && now() - since < LOCK_STALE_MS)
      throw refuse("ApiPay: прошлый запрос по этому клиенту ещё идёт — подождите минуту.");
    if (data) {
      const stale = db.from("operator_settings").delete().eq("key", key);
      const { error: delErr } = await (data.value === null
        ? stale.is("value", null)
        : stale.eq("value", data.value));
      if (delErr) throw serverFailure(`[apipay] отметка не снята: ${delErr.message}`);
    }
    ({ error } = await take());
    if (error) throw refuse("ApiPay: прошлый запрос по этому клиенту ещё идёт — подождите минуту.");
  }
  try {
    return await fn();
  } finally {
    const { error: delErr } = await db.from("operator_settings").delete().eq("key", key);
    if (delErr) console.warn(`[apipay] отметка ${key} не снята: ${delErr.message}`);
  }
}

/** Обрыв неидемпотентного вызова: запрос мог дойти — повторять только после проверки. */
function unsure(e: unknown, what: string): never {
  if (e instanceof PartnerUnreachable)
    throw refuse(
      `ApiPay не ответил: ${what} мог пройти. Обновите карточку и проверьте в кабинете ApiPay, прежде чем повторять.`,
    );
  throw e;
}

/**
 * Счёт за тариф ApiPay на Kaspi плательщика. При обрыве связи не
 * повторяется: второй вызов выставил бы второй счёт.
 */
export async function apipayPayTariff(
  botId: string,
  p: { tierId: string; months: number; phone: string },
  actor: string,
): Promise<void> {
  const { tenant } = await client(botId);
  const phone = payerPhone(p.phone);
  if (!phone) throw refuse("Номер плательщика — в формате +7 7XX XXX XX XX.");
  const orgId = orgIdOf(tenant);
  const c = await partner();
  await withApipayLock(botId, async () => {
    const r = await tariffPay(c, orgId, { tierId: p.tierId, months: p.months, phone }).catch((e) =>
      unsure(e, "счёт за тариф"),
    );
    const body = unwrap(r, "счёт за тариф не выставлен");
    await logEvent(
      botId,
      "payment",
      {
        action: "apipay_tariff_invoice",
        tier: p.tierId,
        months: p.months,
        payment_id: String(body.payment.id),
        amount: body.payment.amount ?? null,
      },
      actor,
    );
  });
}

/**
 * Выпустить продавцу ключ API с нашим вебхуком и сохранить его в настройки
 * продавца. Не идемпотентно: новый ключ сразу отменяет прежний, поэтому
 * перевыпуск — только с `reissue`. Тестовая организация ApiPay (is_test) —
 * тестовый режим у продавца.
 */
export async function apipayIssueKey(
  botId: string,
  reissue: boolean,
  actor: string,
): Promise<{ test: boolean }> {
  const { tenant, ctx } = await client(botId);
  const orgId = orgIdOf(tenant);
  const c = await partner();
  const webhook = `${env().APP_URL.replace(/\/$/, "")}/api/kaspi/${botId}`;
  return withApipayLock(botId, async () => {
    const s = await getSettingsStrict(ctx, ["kaspi_apipay_api_key"]);
    if (s.kaspi_apipay_api_key?.trim() && !reissue)
      throw refuse("Ключ уже выпущен. Перевыпуск отменит прежний — подтвердите его.");
    const org = unwrap(await getOrganization(c, orgId), "организация не прочитана").organization;
    const r = await issueApiKey(c, orgId, webhook).catch((e) => unsure(e, "выпуск ключа"));
    const body = unwrap(r, "ключ не выпущен");
    if (!body.key || !body.webhook_secret) throw serverFailure("ApiPay не вернул ключ или секрет");
    const test = org.is_test === true;
    // Ключ показан один раз: сохраняем сразу, до журнала.
    await setSetting(ctx, "kaspi_apipay_api_key", body.key);
    await setSetting(ctx, "kaspi_apipay_webhook_secret", body.webhook_secret);
    await setSetting(ctx, "kaspi_apipay_test_mode", test ? "true" : "false");
    await setSetting(ctx, "kaspi_apipay_enabled", "true");
    await logEvent(
      botId,
      "payment",
      { action: "apipay_key_issued", regenerated: body.regenerated === true, test },
      actor,
    );
    return { test };
  });
}
