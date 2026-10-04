import { dayKey } from "@/core/analytics/pure";
import { tierAdvice, type TierAdvice } from "@/core/commission/advice";
import { planTierOf, type CommissionMonth } from "@/core/commission/commission";
import { commissionEnabled, commissionForMonth } from "@/core/commission/commission.server";
import { COMMISSION_DEFAULT_START, type PlanTier } from "@/core/plans/registry";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Месяц `ГГГГ-ММ` перед `month`. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export type CommissionPage = {
  enabled: boolean;
  tier: PlanTier | null;
  /** Начало начисления у магазина (своя дата или общая). */
  start: string;
  current: CommissionMonth;
  previous: CommissionMonth;
  /** Подсказка о тарифе: только при включённой комиссии и когда другой тариф дешевле. */
  advice: (TierAdvice & { month: string }) | null;
};

export async function commissionPage(
  ctx: TenantContext,
  now = new Date(),
): Promise<CommissionPage> {
  const enabled = await commissionEnabled();
  const month = dayKey(now, ctx.timezone).slice(0, 7);
  const [current, previous] = await Promise.all([
    commissionForMonth(ctx, month, enabled),
    commissionForMonth(ctx, previousMonth(month), enabled),
  ]);
  const tier = planTierOf(ctx.tenant.plan);
  // Подсказка — по месяцу с большими продажами: текущий ещё неполный.
  const basis = previous.sales > current.sales ? previous : current;
  const advice = enabled && tier ? tierAdvice(tier, basis.sales) : null;
  return {
    enabled,
    tier,
    start: ctx.tenant.settings.commission?.start ?? COMMISSION_DEFAULT_START,
    current,
    previous,
    advice: advice ? { ...advice, month: basis.month } : null,
  };
}
