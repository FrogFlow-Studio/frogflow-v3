import { planModules } from "./plans";
import {
  ADDONS,
  ADDON_MONTHLY_PRICE,
  ANNUAL_BILLED_MONTHS,
  CONNECTION_PRICE,
  MONTHLY_PRICE,
  PLAN_TIERS,
  type AddonKey,
  type PlanNiche,
  type PlanTier,
} from "./registry";

/**
 * Калькулятор тарифа для лендинга: только расчёт по реестру, без записи.
 * Telegram входит в любой тариф; WhatsApp и Instagram входят в тариф, если
 * его план ниши включает модуль канала, иначе доплата `ADDON_MONTHLY_PRICE`
 * за канал. Годовая оплата — `ANNUAL_BILLED_MONTHS` месяцев из 12 на всю
 * месячную сумму (тариф и каналы). Подключение — разово, от годовой оплаты
 * не зависит. Рекомендуется самый дешёвый по месячной сумме тариф; при равенстве
 * — младший.
 */
export type CalcChannel = "telegram" | AddonKey;
/** Порядок на странице. */
export const CALC_CHANNELS: readonly CalcChannel[] = ["telegram", "instagram", "whatsapp"];

export type TierQuote = {
  tier: PlanTier;
  /** Выбранные каналы, которые входят в тариф. */
  included: AddonKey[];
  /** Выбранные каналы с доплатой. */
  extra: AddonKey[];
  /** ₸ в месяц при помесячной оплате. */
  monthly: number;
  /** ₸ в месяц с учётом выбранной оплаты (при годовой — годовая сумма / 12). */
  perMonth: number;
  /** ₸ за год при годовой оплате. */
  yearTotal: number;
  /** Сколько экономит годовая оплата, ₸. */
  yearSaving: number;
  /** Подключение, ₸ разово. */
  connection: number;
};

export type CalcResult = { quotes: TierQuote[]; recommended: PlanTier };

export function quoteTier(
  niche: PlanNiche,
  tier: PlanTier,
  channels: readonly CalcChannel[],
  annual: boolean,
): TierQuote {
  const modules = planModules(niche, tier);
  const picked = (Object.keys(ADDONS) as AddonKey[]).filter((k) => channels.includes(k));
  const included = picked.filter((k) => modules.has(ADDONS[k].modules[0]));
  const extra = picked.filter((k) => !included.includes(k));
  const monthly = MONTHLY_PRICE[tier] + extra.reduce((s, k) => s + ADDON_MONTHLY_PRICE[k], 0);
  const yearTotal = monthly * ANNUAL_BILLED_MONTHS;
  return {
    tier,
    included,
    extra,
    monthly,
    perMonth: annual ? Math.round(yearTotal / 12) : monthly,
    yearTotal,
    yearSaving: monthly * 12 - yearTotal,
    connection: CONNECTION_PRICE[tier],
  };
}

export function calculate(
  niche: PlanNiche,
  channels: readonly CalcChannel[],
  annual: boolean,
): CalcResult {
  const quotes = PLAN_TIERS.map((t) => quoteTier(niche, t, channels, annual));
  const cheapest = quotes.reduce((best, q) => (q.monthly < best.monthly ? q : best));
  return { quotes, recommended: cheapest.tier };
}
