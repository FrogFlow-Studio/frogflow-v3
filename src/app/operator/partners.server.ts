import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { env } from "@/config/env";
import { isInternalTenant } from "@/core/tenant/internal";
import { patchTenantSettings, tenantDirectory } from "@/core/tenant/resolve.server";
import { TIER_TITLES, parsePlan } from "@/core/plans/registry";
import { serverFailure } from "@/lib/server-failure";
import {
  PARTNERS_KEY,
  cleanPartner,
  parsePartners,
  partnerReport,
  partnerToken,
  upsertPartner,
  verifyPartnerToken,
  type Partner,
  type PartnerClient,
  type PartnerReport,
} from "@/core/partners/partners";
import type { Tenant } from "@/core/tenant/types";

/** Партнёрская программа агентств (core/partners): хранение и отчёты для оператора. */
export async function loadPartners(): Promise<Partner[]> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", PARTNERS_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`партнёры не прочитаны: ${error.message}`);
  return parsePartners(data?.value);
}

async function storePartners(list: Partner[]): Promise<void> {
  const db = serviceDb();
  const value = JSON.stringify(list);
  const { data } = await db
    .from("operator_settings")
    .select("key")
    .eq("key", PARTNERS_KEY)
    .maybeSingle();
  const r = data
    ? await db.from("operator_settings").update({ value }).eq("key", PARTNERS_KEY)
    : await db.from("operator_settings").insert({ key: PARTNERS_KEY, value });
  if (r.error) throw serverFailure(`партнёры не сохранены: ${r.error.message}`);
}

export async function savePartner(input: Partial<Partner>): Promise<Partner> {
  const p = cleanPartner(input);
  if (!p)
    throw new Error(
      "Код партнёра — латиница, цифры и дефис (3–30), имя обязательно, процент от 0 до 50",
    );
  await storePartners(upsertPartner(await loadPartners(), p));
  return p;
}

/** Удалить партнёра можно только без клиентов: иначе их комиссия потеряется молча. */
export async function deletePartner(code: string): Promise<void> {
  const clients = (await tenantDirectory(true)).filter((t) => t.settings.partner === code);
  if (clients.length > 0)
    throw new Error("У партнёра есть клиенты — сначала снимите их с партнёра");
  await storePartners((await loadPartners()).filter((p) => p.code !== code));
}

export async function setClientPartner(botId: string, code: string | null): Promise<void> {
  if (code && !(await loadPartners()).some((p) => p.code === code))
    throw new Error("Нет такого партнёра");
  await patchTenantSettings(botId, { partner: code });
}

/** Код партнёра из ссылки регистрации: только существующий, иначе — без партнёра. */
export async function partnerForSignup(code: string | undefined): Promise<string | null> {
  const c = code?.trim().toLowerCase();
  if (!c) return null;
  return (await loadPartners()).some((p) => p.code === c) ? c : null;
}

function clientOf(t: Tenant): PartnerClient {
  const p = parsePlan(t.plan);
  return {
    botId: t.id,
    name: t.name,
    plan: p?.kind === "tier" ? TIER_TITLES[p.tier] : p?.kind === "custom" ? "Индивидуальный" : "—",
    since: t.settings.served_by_since ?? null,
  };
}

async function payments(since: string) {
  return pageAll(
    (from, to) =>
      serviceDb()
        .from("subscription_payments")
        .select("bot_id, paid_at, amount, currency")
        .gte("paid_at", since)
        .order("paid_at")
        .order("id")
        .range(from, to),
    "оплаты подписок",
  );
}

const yearAgo = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString();

export type PartnerOverview = Array<PartnerReport & { link: string }>;

/** Все партнёры с клиентами, оплатами за 12 месяцев, комиссией и ссылкой на отчёт. */
export async function partnersOverview(appUrl: string, now = new Date()): Promise<PartnerOverview> {
  const [partners, tenants, pays] = await Promise.all([
    loadPartners(),
    tenantDirectory(true),
    payments(yearAgo(now)),
  ]);
  const live = tenants.filter((t) => !t.archived && !isInternalTenant(t.id));
  const rows = pays.map((p) => ({ ...p, amount: Number(p.amount) }));
  return partners.map((partner) => ({
    ...partnerReport(
      partner,
      live.filter((t) => t.settings.partner === partner.code).map(clientOf),
      rows,
    ),
    link: `${appUrl}/partner/${partner.code}?t=${partnerToken(env().SESSION_SECRET, partner.code)}`,
  }));
}

/** Отчёт по подписанной ссылке — для самого партнёра, без контактов и чужих клиентов. */
export async function partnerPublicReport(
  code: string,
  token: string,
  now = new Date(),
): Promise<PartnerReport | null> {
  if (!verifyPartnerToken(env().SESSION_SECRET, code, token)) return null;
  const partner = (await loadPartners()).find((p) => p.code === code);
  if (!partner) return null;
  const [tenants, pays] = await Promise.all([tenantDirectory(true), payments(yearAgo(now))]);
  const report = partnerReport(
    partner,
    tenants
      .filter((t) => !t.archived && !isInternalTenant(t.id) && t.settings.partner === code)
      .map(clientOf),
    pays.map((p) => ({ ...p, amount: Number(p.amount) })),
  );
  return { ...report, partner: { ...partner, contact: "" } };
}
