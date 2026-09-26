/**
 * Тариф клиента в панели оператора: выбор плана, надбавки каналов, пробный
 * период, подбор плана действующему клиенту и счёт по плану. Правила — в
 * core/plans, здесь только запись: ключ плана и условия — в
 * `bots.settings.billing`, уровень — в `bots.subscription_plan` (там
 * допустимы только free/basic/pro/enterprise), флаги — в `bots.modules`.
 */
import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/core/modules/registry";
import {
  effectiveModules,
  missingRequirements,
  nextPeriod,
  planInvoice,
  planModules,
  addonModules,
  suggestPlan,
  trialExtension,
  trialWindow,
} from "@/core/plans/plans";
import {
  ADDONS,
  ADDON_MONTHLY_PRICE,
  CUSTOM_PLAN,
  PLAN_VERSION,
  dbPlanFor,
  TRIAL_DAYS,
  TRIAL_EXTEND_MAX_DAYS,
  TRIAL_TIER,
  nicheForVertical,
  parsePlan,
  planKey,
  type AddonKey,
  type PlanTier,
} from "@/core/plans/registry";
import {
  planUsage,
  planWriteBlock,
  upgradeHint,
  USAGE_KEYS,
  type PlanUsage,
  type UpgradeHint,
} from "@/core/plans/tenant";
import {
  invalidateTenantDirectory,
  patchTenantSettings,
  tenantDirectory,
} from "@/core/tenant/resolve.server";
import type { BillingSettings, Tenant } from "@/core/tenant/types";
import { logEvent } from "./operator.server";

const today = () => new Date().toISOString().slice(0, 10);

/** Свежая строка клиента, мимо кэша справочника: правки идут поверх последних. */
async function load(botId: string): Promise<Tenant> {
  const t = (await tenantDirectory(true)).find((x) => x.id === botId);
  if (!t) throw new Error("Клиент не найден");
  return t;
}

/**
 * Записать план: ключ — в `settings.billing.plan`, в `bots.subscription_plan` —
 * допустимый базой уровень (`dbPlanFor`). Колонка первой: если база её
 * отклонит, настройки не меняются.
 */
async function writePlan(botId: string, plan: string, billing: BillingSettings): Promise<void> {
  const { error } = await serviceDb()
    .from("bots")
    .update({ subscription_plan: dbPlanFor(plan) })
    .eq("id", botId);
  if (error) throw new Error(error.message);
  await patchTenantSettings(botId, { billing: { ...billing, plan } });
}

/** Клиент для изменения плана: клиента v1 не трогаем (planWriteBlock). */
async function loadWritable(botId: string): Promise<Tenant> {
  const t = await load(botId);
  assertWritable(t);
  return t;
}

function assertWritable(t: Tenant): void {
  const block = planWriteBlock(t);
  if (block) throw new Error(block);
}

async function writeModules(botId: string, modules: Record<ModuleKey, boolean>): Promise<void> {
  const missing = missingRequirements(modules);
  if (missing.length) throw new Error(`Не хватает зависимостей модулей: ${missing.join(", ")}`);
  const { error } = await serviceDb()
    .from("bots")
    .update({ modules: modules as unknown as Json })
    .eq("id", botId);
  if (error) throw new Error(error.message);
}

/** Пересчитать флаги по плану клиента; custom и без плана — не трогаем. */
async function syncModules(t: Tenant, billing: BillingSettings): Promise<void> {
  const mods = effectiveModules(parsePlan(t.plan), billing);
  if (mods) await writeModules(t.id, mods);
}

/** Расход ИИ за месяц против лимитов плана. */
async function usageOf(t: Tenant): Promise<PlanUsage> {
  const { data } = await serviceDb()
    .from("app_settings")
    .select("key, value")
    .eq("bot_id", t.id)
    .in("key", Object.values(USAGE_KEYS));
  return planUsage(t, Object.fromEntries((data ?? []).map((r) => [r.key, r.value])));
}

export type PlanView = {
  plan: string | null;
  niche: string | null;
  billing: BillingSettings;
  usage: PlanUsage;
  /** Подсказка для действующего клиента без плана. */
  suggestion: { tier: PlanTier; grandfathered: ModuleKey[] } | null;
  /** Модули, включённые сейчас, но не входящие в план, надбавки и сохранённые. */
  outsidePlan: ModuleKey[];
  /** Причина, по которой план сейчас менять нельзя (клиент на v1), или null. */
  writeBlock: string | null;
  /** Лимиты подходят к концу — предложить план выше. */
  upgrade: UpgradeHint | null;
};

export async function getPlanView(botId: string): Promise<PlanView> {
  const t = await load(botId);
  const niche = nicheForVertical(t.vertical);
  const billing = t.settings.billing ?? {};
  const parsed = parsePlan(t.plan);
  const suggestion = niche && !parsed ? suggestPlan(niche, t.modules) : null;
  let outsidePlan: ModuleKey[] = [];
  if (parsed?.kind === "tier") {
    const allowed = planModules(parsed.niche, parsed.tier);
    for (const m of addonModules(parsed.niche, billing)) allowed.add(m);
    for (const m of billing.grandfathered ?? []) allowed.add(m);
    outsidePlan = MODULE_KEYS.filter((k) => t.modules[k] && !allowed.has(k));
  }
  const usage = await usageOf(t);
  return {
    plan: t.plan,
    niche,
    billing,
    usage,
    suggestion: suggestion && { tier: suggestion.tier, grandfathered: suggestion.grandfathered },
    outsidePlan,
    writeBlock: planWriteBlock(t),
    upgrade: upgradeHint(t.plan, usage),
  };
}

/**
 * Поставить план. Флаги модулей пересчитываются сразу: всё, что не в плане,
 * не в надбавках и не сохранено, выключается. `custom` — индивидуальные
 * условия: модули остаются как есть и дальше включаются вручную.
 */
export async function setPlan(
  botId: string,
  input: { tier: PlanTier | "custom"; period: "month" | "year"; addons: AddonKey[] },
  actor: string,
): Promise<void> {
  const t = await loadWritable(botId);
  let plan: string;
  if (input.tier === "custom") plan = CUSTOM_PLAN;
  else {
    const niche = nicheForVertical(t.vertical);
    if (!niche)
      throw new Error(
        "У этой ниши нет тарифов (консультант BOVI — по договору): выберите «Индивидуальный».",
      );
    plan = planKey(niche, input.tier);
  }
  const billing: BillingSettings = {
    ...(t.settings.billing ?? {}),
    period: input.period,
    addons: input.addons.filter((a) => a in ADDONS),
    plan_version: PLAN_VERSION,
  };
  await writePlan(botId, plan, billing);
  await syncModules({ ...t, plan }, billing);
  invalidateTenantDirectory();
  await logEvent(
    botId,
    "meta",
    { plan, from: t.plan, period: input.period, addons: billing.addons },
    actor,
  );
}

/**
 * Перевести действующего клиента на подобранный план: купленное сверх
 * плана сохраняется бесплатно, подключение не берётся, срок подписки не
 * меняется — новая цена действует со следующего счёта.
 */
export async function adoptSuggestedPlan(botId: string, actor: string): Promise<void> {
  const t = await loadWritable(botId);
  const niche = nicheForVertical(t.vertical);
  if (!niche) throw new Error("У этой ниши нет тарифов.");
  if (parsePlan(t.plan)) throw new Error("План уже выбран.");
  const s = suggestPlan(niche, t.modules);
  const plan = planKey(niche, s.tier);
  const billing: BillingSettings = {
    ...(t.settings.billing ?? {}),
    grandfathered: s.grandfathered,
    connection_paid_at: t.settings.billing?.connection_paid_at ?? new Date().toISOString(),
    period: t.settings.billing?.period ?? "month",
    plan_version: PLAN_VERSION,
  };
  await writePlan(botId, plan, billing);
  await syncModules({ ...t, plan }, billing);
  invalidateTenantDirectory();
  await logEvent(botId, "meta", { plan, adopted: true, grandfathered: s.grandfathered }, actor);
}

/**
 * Пробный период: Basic ниши на TRIAL_DAYS дней, один раз на клиента.
 * Включается сам при регистрации (/signup), клиенту, заведённому
 * оператором, — кнопкой. Срок подписки двигается нулевым платежом — тем же
 * путём, что и оплата, так что обход неоплаты предупредит и остановит по
 * обычной политике.
 */
export async function startTrial(botId: string, actor: string): Promise<{ until: string }> {
  const t = await loadWritable(botId);
  const niche = nicheForVertical(t.vertical);
  if (!niche) throw new Error("У этой ниши нет тарифов.");
  if (t.settings.billing?.trial_until) throw new Error("Пробный период у клиента уже был.");
  const { until } = trialWindow(today());
  const plan = planKey(niche, TRIAL_TIER);
  const billing: BillingSettings = {
    ...(t.settings.billing ?? {}),
    trial_until: until,
    period: t.settings.billing?.period ?? "month",
    plan_version: PLAN_VERSION,
  };
  await writePlan(botId, plan, billing);
  await syncModules({ ...t, plan }, billing);
  const { addPayment } = await import("./billing.server");
  await addPayment(
    botId,
    {
      period_start: today(),
      period_end: until,
      amount: 0,
      currency: "KZT",
      note: `Пробный период ${TRIAL_DAYS} дней`,
    },
    actor,
  );
  invalidateTenantDirectory();
  await logEvent(botId, "meta", { plan, trial_until: until }, actor);
  return { until };
}

/**
 * Продление пробного периода оператором: ещё один нулевой платёж вплотную
 * к текущему сроку. Только пока клиент не платил: после оплаты пробный
 * период кончился, дальше — счёт.
 */
export async function extendTrial(
  botId: string,
  days: number,
  actor: string,
): Promise<{ until: string }> {
  if (!Number.isInteger(days) || days < 1 || days > TRIAL_EXTEND_MAX_DAYS)
    throw new Error(`Продлить можно на 1–${TRIAL_EXTEND_MAX_DAYS} дней за раз.`);
  const t = await loadWritable(botId);
  const trialUntil = t.settings.billing?.trial_until;
  if (!trialUntil) throw new Error("У клиента не было пробного периода — сначала включите его.");
  const { addPayment, subscriptionExpiresAt } = await import("./billing.server");
  const expires = (await subscriptionExpiresAt(botId))?.slice(0, 10) ?? null;
  if (expires && expires > trialUntil)
    throw new Error("Клиент уже оплатил подписку после пробного периода — продлевать нечего.");
  const { start, end } = trialExtension(trialUntil, days, today());
  await addPayment(
    botId,
    {
      period_start: start,
      period_end: end,
      amount: 0,
      currency: "KZT",
      note: `Продление пробного периода на ${days} дн.`,
    },
    actor,
  );
  await patchTenantSettings(botId, {
    billing: { ...(t.settings.billing ?? {}), trial_until: end },
  });
  invalidateTenantDirectory();
  await logEvent(botId, "meta", { trial_until: end, trial_extended_days: days }, actor);
  return { until: end };
}

/**
 * Модуль сверх плана руками оператора (подарок, договорённость): включение
 * записывает его в сохранённые, выключение — убирает. Модуль из плана или
 * надбавки выключить нельзя: для этого меняют план.
 */
export async function toggleModuleOnPlan(
  t: Tenant,
  key: ModuleKey,
  on: boolean,
  actor: string,
): Promise<void> {
  assertWritable(t);
  const parsed = parsePlan(t.plan);
  if (parsed?.kind !== "tier") throw new Error("У клиента нет плана");
  const billing = t.settings.billing ?? {};
  const inPlan = planModules(parsed.niche, parsed.tier).has(key);
  const inAddon = addonModules(parsed.niche, billing).includes(key);
  if (!on && (inPlan || inAddon))
    throw new Error(
      `«${moduleDef(key).title}» входит в план или надбавку — чтобы выключить, смените план.`,
    );
  if (on && moduleDef(key).status !== "available")
    throw new Error(`Модуль «${moduleDef(key).title}» ещё не реализован — включить нельзя.`);
  const set = new Set(billing.grandfathered ?? []);
  if (on && !inPlan && !inAddon) set.add(key);
  if (!on) set.delete(key);
  const next: BillingSettings = { ...billing, grandfathered: [...set] };
  const mods = effectiveModules(parsed, next)!;
  const missing = missingRequirements(mods);
  if (missing.length) throw new Error(`Сначала включите зависимость: ${missing.join(", ")}`);
  await patchTenantSettings(t.id, { billing: next });
  await writeModules(t.id, mods);
  invalidateTenantDirectory();
  await logEvent(t.id, on ? "module_on" : "module_off", { module: key, grandfathered: on }, actor);
}

export async function setAiQuota(
  botId: string,
  quota: { ai_dialogs?: number | null; receipt_checks?: number | null },
  actor: string,
): Promise<void> {
  // Замена целиком, а не слияние: «как в плане» (undefined) должно стирать прежнее значение.
  const t = await load(botId);
  const clean = Object.fromEntries(
    Object.entries(quota).filter(([, v]) => v !== undefined),
  ) as BillingSettings["ai_quota"];
  await patchTenantSettings(botId, {
    billing: { ...(t.settings.billing ?? {}), ai_quota: clean },
  });
  invalidateTenantDirectory();
  await logEvent(botId, "meta", { ai_quota: clean ?? null }, actor);
}

/** Цена надбавки: названная оператором, иначе по тарифу (ADDON_MONTHLY_PRICE). */
function addonPrice(a: AddonKey, named: number | undefined): number {
  return typeof named === "number" && Number.isFinite(named) && named >= 0
    ? named
    : ADDON_MONTHLY_PRICE[a];
}

/** Сумма и состав счёта по плану — для предпросмотра в панели. */
export function planInvoicePreview(
  t: Pick<Tenant, "plan" | "settings">,
  addonPrices: Partial<Record<AddonKey, number>>,
  period?: "month" | "year",
) {
  const parsed = parsePlan(t.plan);
  if (parsed?.kind !== "tier") throw new Error("Счёт по плану — только для клиента на плане");
  const billing = t.settings.billing ?? {};
  return planInvoice(parsed.tier, {
    period: period ?? billing.period ?? "month",
    withConnection: !billing.connection_paid_at,
    addons: (billing.addons ?? []).map((a) => ({
      title: ADDONS[a].title,
      monthly: addonPrice(a, addonPrices[a]),
    })),
  });
}

/**
 * Счёт по плану: подписка за месяц или год, надбавки по названной цене и
 * подключение, если оно ещё не оплачено. Счёт с подключением запоминается —
 * его подтверждение отмечает подключение оплаченным.
 */
export async function createPlanInvoice(
  botId: string,
  input: { period: "month" | "year"; addonPrices: Partial<Record<AddonKey, number>> },
  actor: string,
) {
  const t = await loadWritable(botId);
  const inv = planInvoicePreview(t, input.addonPrices, input.period);
  const { createInvoice } = await import("./billing.server");
  const r = await createInvoice(
    botId,
    { amount: inv.amount, currency: "KZT", note: inv.note },
    actor,
  );
  const billing = t.settings.billing ?? {};
  await patchTenantSettings(botId, {
    billing: {
      ...billing,
      period: input.period,
      ...(!billing.connection_paid_at ? { connection_invoice_id: r.invoice.id } : {}),
    },
  });
  invalidateTenantDirectory();
  return r;
}

/** После подтверждения счёта: счёт с подключением закрывает подключение. */
export async function onInvoicePaid(botId: string, invoiceId: string): Promise<void> {
  const t = await load(botId);
  const b = t.settings.billing;
  if (b?.connection_invoice_id === invoiceId && !b.connection_paid_at) {
    await patchTenantSettings(botId, {
      billing: { ...b, connection_paid_at: new Date().toISOString() },
    });
    invalidateTenantDirectory();
  }
}

/** Период для подтверждения счёта: продолжение подписки на месяц или год клиента. */
export async function suggestedPeriod(botId: string): Promise<{ start: string; end: string }> {
  const t = await load(botId);
  const { data } = await serviceDb()
    .from("bots")
    .select("subscription_expires_at")
    .eq("id", botId)
    .maybeSingle();
  return nextPeriod(
    data?.subscription_expires_at ?? null,
    t.settings.billing?.period ?? "month",
    today(),
  );
}
