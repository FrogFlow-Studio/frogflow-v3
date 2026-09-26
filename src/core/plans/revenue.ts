import {
  ADDON_MONTHLY_PRICE,
  ANNUAL_BILLED_MONTHS,
  MONTHLY_PRICE,
  parsePlan,
  type PlanTier,
} from "./registry";
import type { BillingSettings } from "@/core/tenant/types";

/**
 * Выручка платформы для оператора — из дат и планов, без базы. MRR —
 * сколько платящие клиенты приносят в месяц по своему плану: подписка плюс
 * надбавки каналов по цене из registry; годовая оплата — 10/12 месячной.
 * Подключение разовое и в MRR не входит, оно видно в поступлениях.
 * Индивидуальные условия (`custom`) в MRR не считаются: цены у них нет.
 */
export type RevenueState =
  /** Оплачено, срок идёт. */
  | "paying"
  /** Пробный период идёт, денег ещё не было. */
  | "trial"
  /** Срок кончился — ждём оплату. */
  | "overdue"
  /** Нет плана с ценой (нет плана или custom). */
  | "no_plan";

export type RevenueClient = {
  plan: string | null;
  billing: BillingSettings;
  /** bots.subscription_expires_at */
  expiresAt: string | null;
  archived?: boolean;
};

/** Сколько клиент приносит в месяц по плану; null — плана с ценой нет. */
export function monthlyRevenue(plan: string | null, billing: BillingSettings): number | null {
  const p = parsePlan(plan);
  if (p?.kind !== "tier") return null;
  const addons = (billing.addons ?? []).reduce((s, a) => s + (ADDON_MONTHLY_PRICE[a] ?? 0), 0);
  const monthly = MONTHLY_PRICE[p.tier] + addons;
  return billing.period === "year" ? Math.round((monthly * ANNUAL_BILLED_MONTHS) / 12) : monthly;
}

export function revenueState(c: RevenueClient, today: string): RevenueState {
  if (monthlyRevenue(c.plan, c.billing) === null) return "no_plan";
  const exp = c.expiresAt?.slice(0, 10) ?? null;
  const trial = c.billing.trial_until;
  if (trial && trial >= today && (!exp || exp <= trial)) return "trial";
  if (exp && exp >= today) return "paying";
  return "overdue";
}

export type RevenueSummary = {
  mrr: number;
  arr: number;
  paying: number;
  /** Средний платёж платящего клиента в месяц. */
  arpu: number;
  trial: number;
  /** Сколько добавит MRR, если все в пробном начнут платить. */
  trialMrr: number;
  overdue: number;
  /** MRR, который теряем, если просроченные не заплатят. */
  overdueMrr: number;
  noPlan: number;
  byTier: Record<PlanTier, { clients: number; mrr: number }>;
};

export function summarizeRevenue(clients: RevenueClient[], today: string): RevenueSummary {
  const s: RevenueSummary = {
    mrr: 0,
    arr: 0,
    paying: 0,
    arpu: 0,
    trial: 0,
    trialMrr: 0,
    overdue: 0,
    overdueMrr: 0,
    noPlan: 0,
    byTier: {
      basic: { clients: 0, mrr: 0 },
      pro: { clients: 0, mrr: 0 },
      business: { clients: 0, mrr: 0 },
    },
  };
  for (const c of clients) {
    if (c.archived) continue;
    const m = monthlyRevenue(c.plan, c.billing) ?? 0;
    const state = revenueState(c, today);
    if (state === "no_plan") s.noPlan++;
    else if (state === "trial") {
      s.trial++;
      s.trialMrr += m;
    } else if (state === "overdue") {
      s.overdue++;
      s.overdueMrr += m;
    } else {
      s.paying++;
      s.mrr += m;
      const p = parsePlan(c.plan);
      if (p?.kind === "tier") {
        s.byTier[p.tier].clients++;
        s.byTier[p.tier].mrr += m;
      }
    }
  }
  s.arr = s.mrr * 12;
  s.arpu = s.paying ? Math.round(s.mrr / s.paying) : 0;
  return s;
}

/** Поступления по месяцам (YYYY-MM) за последние `months`, пустые месяцы — нулём. */
export function cashByMonth(
  payments: Array<{ paid_at: string; amount: number; currency: string }>,
  today: string,
  months = 12,
): Array<{ month: string; amount: number; count: number }> {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  const acc = new Map(keys.map((k) => [k, { month: k, amount: 0, count: 0 }]));
  for (const p of payments) {
    if (p.currency !== "KZT" || !(p.amount > 0)) continue;
    const row = acc.get(p.paid_at.slice(0, 7));
    if (!row) continue;
    row.amount += p.amount;
    row.count++;
  }
  return [...acc.values()];
}
