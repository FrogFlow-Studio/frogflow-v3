import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { isInternalTenant } from "@/core/tenant/internal";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { TIER_TITLES, parsePlan, type PlanTier } from "@/core/plans/registry";
import {
  cashByMonth,
  cashByMonthAndTier,
  churnSummary,
  monthlyRevenue,
  revenueState,
  summarizeRevenue,
  upcomingRenewals,
  type ChurnSummary,
  type Renewal,
  type RevenueState,
  type RevenueSummary,
  type TierMonth,
} from "@/core/plans/revenue";

/**
 * Панель выручки оператора: MRR по планам клиентов, пробные и
 * просроченные, поступления по месяцам из subscription_payments. Правила
 * — в core/plans/revenue, здесь только чтение.
 */
export type RevenueRow = {
  botId: string;
  name: string;
  plan: string;
  state: RevenueState;
  monthly: number;
  expiresAt: string | null;
  trialUntil: string | null;
};

export type RevenueReport = {
  summary: RevenueSummary;
  cash: Array<{ month: string; amount: number; count: number }>;
  /** Поступления по месяцам и текущим тарифам клиентов (только оплаченные). */
  cashByTier: TierMonth[];
  /** Продления в ближайшие 14 дней и сколько за них ожидается. */
  renewals: Renewal[];
  renewalsExpected: number;
  churn: ChurnSummary;
  clients: RevenueRow[];
};

const ORDER: Record<RevenueState, number> = { overdue: 0, trial: 1, paying: 2, no_plan: 3 };

export async function revenueReport(now = new Date()): Promise<RevenueReport> {
  const today = now.toISOString().slice(0, 10);
  // «Демо-тестер» и другие стенды — не выручка.
  const all = await tenantDirectory(true);
  const tenants = all.filter((t) => !t.archived && !isInternalTenant(t.id));
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString();
  const [bots, payments] = await Promise.all([
    pageAll<{ id: string; subscription_expires_at: string | null }>(
      (from, to) =>
        serviceDb().from("bots").select("id, subscription_expires_at").order("id").range(from, to),
      "сроки подписок",
    ),
    pageAll(
      (from, to) =>
        serviceDb()
          .from("subscription_payments")
          .select("bot_id, paid_at, amount, currency")
          .gte("paid_at", since)
          .order("paid_at")
          .order("id")
          .range(from, to),
      "оплаты подписок",
    ),
  ]);
  const expires = new Map(bots.map((b) => [b.id, b.subscription_expires_at]));
  const input = tenants.map((t) => ({
    t,
    c: {
      plan: t.plan,
      billing: t.settings.billing ?? {},
      expiresAt: expires.get(t.id) ?? null,
    },
  }));
  const clients: RevenueRow[] = input
    .map(({ t, c }) => {
      const p = parsePlan(c.plan);
      return {
        botId: t.id,
        name: t.name,
        plan:
          p?.kind === "tier" ? TIER_TITLES[p.tier] : p?.kind === "custom" ? "Индивидуальный" : "—",
        state: revenueState(c, today),
        monthly: monthlyRevenue(c.plan, c.billing) ?? 0,
        expiresAt: c.expiresAt,
        trialUntil: c.billing.trial_until ?? null,
      };
    })
    .filter((r) => r.state !== "no_plan")
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.monthly - a.monthly);
  const paid = payments
    .filter((p) => !isInternalTenant(p.bot_id))
    .map((p) => ({ ...p, amount: Number(p.amount) }));
  // Тариф платежа — текущий тариф клиента; архивные клиенты тоже учитываются в поступлениях.
  const tierByBot = new Map<string, PlanTier>();
  for (const t of all) {
    const p = parsePlan(t.plan);
    if (p?.kind === "tier") tierByBot.set(t.id, p.tier);
  }
  const named = input.map(({ t, c }) => ({ ...c, botId: t.id, name: t.name }));
  const upcoming = upcomingRenewals(named, today, 14);
  return {
    summary: summarizeRevenue(
      input.map((x) => x.c),
      today,
    ),
    cash: cashByMonth(paid, today),
    cashByTier: cashByMonthAndTier(paid, (id) => tierByBot.get(id) ?? null, today),
    renewals: upcoming.renewals,
    renewalsExpected: upcoming.expectedTotal,
    churn: churnSummary(named, today, 30),
    clients,
  };
}
