/**
 * Расчёты тарифов без базы: какие модули включает план, лимиты, цена счёта,
 * подбор плана действующему клиенту. Запись в базу — в панели оператора
 * (app/operator/plans.server.ts), здесь только правила.
 */
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/core/modules/registry";
import type { BillingSettings } from "@/core/tenant/types";
import {
  ADDONS,
  ANNUAL_BILLED_MONTHS,
  BASE_MODULES,
  CONNECTION_PRICE,
  COURSES_FROM_TIER,
  COURSES_NICHES,
  COURSES_SALE,
  MONTHLY_PRICE,
  MULTI_BOT_FROM_TIER,
  PLAN_LIMITS,
  PLAN_MODULES,
  PLAN_TIERS,
  SHOP_CHANNEL_MODULES,
  TIER_TITLES,
  TRIAL_DAYS,
  type CoursesSale,
  type ParsedPlan,
  type PlanLimits,
  type PlanNiche,
  type PlanTier,
} from "./registry";

/**
 * Модули уровня ниши с учётом нижних уровней и базы. `sale` — как продаются
 * «Курсы» (COURSES_SALE в registry), параметром только для тестов.
 */
export function planModules(
  niche: PlanNiche,
  tier: PlanTier,
  sale: CoursesSale = COURSES_SALE,
  /** Ниша клиента: у «Онлайн-школы» курсы — сам продукт, в любом тарифе. */
  vertical?: string | null,
): Set<ModuleKey> {
  const out = new Set<ModuleKey>(BASE_MODULES);
  for (const t of PLAN_TIERS) {
    for (const m of PLAN_MODULES[niche][t]) out.add(m);
    if (t === tier) break;
  }
  if (
    sale === "plan" &&
    COURSES_NICHES.includes(niche) &&
    PLAN_TIERS.indexOf(tier) >= PLAN_TIERS.indexOf(COURSES_FROM_TIER)
  )
    out.add("courses");
  if (sale !== "off" && (vertical === "courses" || niche === "courses")) out.add("courses");
  if (MULTI_BOT_FROM_TIER && PLAN_TIERS.indexOf(tier) >= PLAN_TIERS.indexOf(MULTI_BOT_FROM_TIER))
    out.add("multi_bot");
  return out;
}

/**
 * Купленное не пропадает (правило Якова: старые клиенты сохраняют купленные
 * модули бесплатно). При любом назначении плана включённые сейчас модули,
 * которые не пришли из прежнего плана и его надбавок, переходят в
 * сохранённые (billing.grandfathered) вместе с уже сохранёнными. Так
 * понижение плана выключает модули прежнего плана, но не купленное сверх
 * него. Базовые модули есть в каждом плане, «в разработке» — не хранятся.
 */
export function keptModules(
  prev: ParsedPlan,
  prevBilling: BillingSettings | undefined,
  modulesOn: Partial<Record<string, boolean>>,
): ModuleKey[] {
  const fromPlan = new Set<ModuleKey>(BASE_MODULES);
  if (prev?.kind === "tier") {
    for (const m of planModules(prev.niche, prev.tier)) fromPlan.add(m);
    for (const m of addonModules(prev.niche, prevBilling)) fromPlan.add(m);
  }
  const out = new Set<ModuleKey>(prevBilling?.grandfathered ?? []);
  for (const k of MODULE_KEYS)
    if (modulesOn[k] && !fromPlan.has(k) && moduleDef(k).status === "available") out.add(k);
  return MODULE_KEYS.filter((k) => out.has(k));
}

/** Модули надбавок; у консультанта без кассы — без магазина в канале. */
export function addonModules(niche: PlanNiche, billing: BillingSettings | undefined): ModuleKey[] {
  const out: ModuleKey[] = [];
  for (const a of billing?.addons ?? [])
    for (const m of ADDONS[a].modules)
      if (niche !== "consultant_universal" || !SHOP_CHANNEL_MODULES.includes(m)) out.push(m);
  return out;
}

/**
 * Полный набор флагов `bots.modules` для клиента на плане: план ∪ надбавки ∪
 * сохранённые модули. Всё прочее выключено — понижение плана выключает то,
 * что в новый план не входит. Для `custom` и клиента без плана — null:
 * модули остаются такими, как их выставил оператор.
 */
export function effectiveModules(
  plan: ParsedPlan,
  billing: BillingSettings | undefined,
  sale: CoursesSale = COURSES_SALE,
  vertical?: string | null,
): Record<ModuleKey, boolean> | null {
  if (!plan || plan.kind !== "tier") return null;
  const on = planModules(plan.niche, plan.tier, sale, vertical);
  for (const m of addonModules(plan.niche, billing)) on.add(m);
  for (const m of billing?.grandfathered ?? []) on.add(m);
  if (sale === "off") on.delete("courses");
  const out = {} as Record<ModuleKey, boolean>;
  for (const k of MODULE_KEYS) out[k] = on.has(k) && moduleDef(k).status === "available";
  return out;
}

/** Включённые модули, чьи зависимости выключены, — для проверки перед записью. */
export function missingRequirements(modules: Record<ModuleKey, boolean>): string[] {
  const out: string[] = [];
  for (const k of MODULE_KEYS)
    if (modules[k])
      for (const r of moduleDef(k).requires ?? [])
        if (!modules[r as ModuleKey]) out.push(`${k} → ${r}`);
  return out;
}

/** Лимиты месяца: индивидуальные поверх плана; без плана (или custom) — null, не ограничиваем. */
export function planLimits(
  plan: ParsedPlan,
  billing: BillingSettings | undefined,
): PlanLimits | null {
  if (!plan || plan.kind !== "tier") return null;
  const base = PLAN_LIMITS[plan.tier];
  const q = billing?.ai_quota;
  return {
    aiDialogs: q?.ai_dialogs !== undefined ? q.ai_dialogs : base.aiDialogs,
    receiptChecks: q?.receipt_checks !== undefined ? q.receipt_checks : base.receiptChecks,
  };
}

/** Лимит исчерпан? null — без лимита. */
export function overLimit(used: number, limit: number | null | undefined): boolean {
  return typeof limit === "number" && used >= limit;
}

export type InvoiceLine = { title: string; amount: number };

/**
 * Счёт по плану: подписка за месяц или год (10 месяцев вместо 12) плюс
 * подключение, если оно ещё не оплачено. Надбавки за каналы — отдельными
 * строками по цене, которую назвал оператор.
 */
export function planInvoice(
  tier: PlanTier,
  opts: {
    period: "month" | "year";
    withConnection: boolean;
    addons?: Array<{ title: string; monthly: number }>;
    /** Скидка на подключение (приглашённому автору); только вместе с подключением, не больше его цены. */
    connectionDiscount?: { title: string; amount: number };
  },
): { amount: number; lines: InvoiceLine[]; note: string } {
  const months = opts.period === "year" ? ANNUAL_BILLED_MONTHS : 1;
  const lines: InvoiceLine[] = [
    {
      title:
        opts.period === "year"
          ? `План ${TIER_TITLES[tier]} на год (12 мес. по цене ${months})`
          : `План ${TIER_TITLES[tier]} на месяц`,
      amount: MONTHLY_PRICE[tier] * months,
    },
  ];
  for (const a of opts.addons ?? [])
    if (a.monthly > 0) lines.push({ title: `${a.title} сверх плана`, amount: a.monthly * months });
  if (opts.withConnection)
    lines.push({ title: `Подключение ${TIER_TITLES[tier]}`, amount: CONNECTION_PRICE[tier] });
  const off = opts.withConnection ? opts.connectionDiscount : undefined;
  if (off && off.amount > 0)
    lines.push({ title: off.title, amount: -Math.min(off.amount, CONNECTION_PRICE[tier]) });
  const amount = lines.reduce((s, l) => s + l.amount, 0);
  return { amount, lines, note: lines.map((l) => `${l.title}: ${l.amount} ₸`).join("; ") };
}

const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Оплаченный период: продолжает текущую подписку без разрыва, а если она
 * уже истекла — начинается сегодня. Конец — через месяц или 12 месяцев.
 */
export function nextPeriod(
  expiresAt: string | null,
  period: "month" | "year",
  today: string,
): { start: string; end: string } {
  const exp = expiresAt ? expiresAt.slice(0, 10) : null;
  const start = exp && exp >= today ? addDays(exp, 1) : today;
  return { start, end: addDays(addMonths(start, period === "year" ? 12 : 1), -1) };
}

/**
 * Пробный период: Basic ниши на TRIAL_DAYS дней, считая сегодняшний, один
 * раз на клиента. Конец включительно — как у оплаченного периода.
 */
export function trialWindow(today: string): { until: string } {
  return { until: addDays(today, TRIAL_DAYS - 1) };
}

/**
 * Продление пробного периода оператором: без разрыва с текущим, а если он
 * уже кончился — с сегодняшнего дня. Конец включительно.
 */
export function trialExtension(
  trialUntil: string,
  days: number,
  today: string,
): { start: string; end: string } {
  const start = trialUntil >= today ? addDays(trialUntil, 1) : today;
  return { start, end: addDays(start, days - 1) };
}

/**
 * Подбор плана действующему клиенту. Всё, что клиент купил по старой схеме,
 * остаётся у него бесплатно (grandfathered), поэтому уровень выше имеет
 * смысл, только если он забирает хотя бы два его модуля: ради одного
 * модуля клиента не переводят на дорогой план — модуль просто сохраняется.
 * Оператор видит подсказку и решает сам.
 */
export const UPGRADE_MIN_MODULES = 2;

export function suggestPlan(
  niche: PlanNiche,
  modulesOn: Record<string, boolean>,
): { tier: PlanTier; grandfathered: ModuleKey[]; coveredBy: Record<PlanTier, number> } {
  const on = MODULE_KEYS.filter((k) => modulesOn[k] && !BASE_MODULES.includes(k));
  const coveredBy = {} as Record<PlanTier, number>;
  for (const t of PLAN_TIERS) {
    const set = planModules(niche, t);
    coveredBy[t] = on.filter((k) => set.has(k)).length;
  }
  let tier: PlanTier = "basic";
  for (const t of PLAN_TIERS.slice(1)) {
    if (coveredBy[t] - coveredBy[tier] >= UPGRADE_MIN_MODULES) tier = t;
  }
  const set = planModules(niche, tier);
  return { tier, grandfathered: on.filter((k) => !set.has(k)), coveredBy };
}
