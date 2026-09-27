import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { isInternalTenant } from "@/core/tenant/internal";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { TIER_TITLES, parsePlan } from "@/core/plans/registry";
import {
  cashByMonth,
  monthlyRevenue,
  revenueState,
  summarizeRevenue,
  type RevenueState,
  type RevenueSummary,
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
  clients: RevenueRow[];
};

const ORDER: Record<RevenueState, number> = { overdue: 0, trial: 1, paying: 2, no_plan: 3 };

export async function revenueReport(now = new Date()): Promise<RevenueReport> {
  const today = now.toISOString().slice(0, 10);
  // «Демо-тестер» и другие стенды — не выручка.
  const tenants = (await tenantDirectory(true)).filter(
    (t) => !t.archived && !isInternalTenant(t.id),
  );
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString();
  const [bots, payments] = await Promise.all([
    serviceDb().from("bots").select("id, subscription_expires_at"),
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
  if (bots.error) throw new Error(bots.error.message);
  const expires = new Map((bots.data ?? []).map((b) => [b.id, b.subscription_expires_at]));
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
  return {
    summary: summarizeRevenue(
      input.map((x) => x.c),
      today,
    ),
    cash: cashByMonth(
      payments
        .filter((p) => !isInternalTenant(p.bot_id))
        .map((p) => ({ ...p, amount: Number(p.amount) })),
      today,
    ),
    clients,
  };
}
