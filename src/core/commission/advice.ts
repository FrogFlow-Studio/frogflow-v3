import {
  COMMISSION_FREE_MONTHLY,
  COMMISSION_RATE_PERCENT,
  MONTHLY_PRICE,
  PLAN_TIERS,
  type PlanTier,
} from "@/core/plans/registry";

/**
 * Подсказка «с вашими продажами выгоднее тариф X»: подписка плюс комиссия за
 * месяц на каждом тарифе при тех же продажах витрины. Считается по реальным
 * ставкам и ценам из registry, а не по круглым цифрам: точки, где тариф
 * выгоднее соседнего, получаются сами (между Базовым и Про — около 250 000 ₸
 * продаж в месяц, между Про и Бизнесом — около 550 000 ₸). Доплаты за
 * каналы в сравнение не входят: они одинаковы на всех тарифах.
 */
const cents = (n: number) => Math.round(n * 100) / 100;

export function monthlyCost(tier: PlanTier, sales: number): number {
  const taxable = Math.max(0, sales - COMMISSION_FREE_MONTHLY);
  return cents(MONTHLY_PRICE[tier] + (taxable * COMMISSION_RATE_PERCENT[tier]) / 100);
}

export type TierAdvice = { tier: PlanTier; cost: number; currentCost: number; saving: number };

/** Самый дешёвый тариф, если он дешевле нынешнего; нет — null. Равные цены — остаёмся на своём. */
export function tierAdvice(current: PlanTier, sales: number): TierAdvice | null {
  const currentCost = monthlyCost(current, sales);
  let best: { tier: PlanTier; cost: number } | null = null;
  for (const tier of PLAN_TIERS) {
    if (tier === current) continue;
    const cost = monthlyCost(tier, sales);
    if (cost < currentCost && (!best || cost < best.cost)) best = { tier, cost };
  }
  return best
    ? { tier: best.tier, cost: best.cost, currentCost, saving: cents(currentCost - best.cost) }
    : null;
}
