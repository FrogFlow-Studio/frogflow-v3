import { analyticsRevenue, dominantCurrency, includeOrderInAnalytics } from "@/core/analytics/pure";

/**
 * Блок «Рост» на главной (У5): три числа за последние 30 суток против прежних
 * 30 — выручка, оплаченные заказы, новые покупатели. Заказы — те же, что в
 * аналитике (includeOrderInAnalytics, за вычетом возвратов); суммы одной,
 * основной валюты. Модуль без базы: его читают сервер и тесты.
 */
export const GROWTH_DAYS = 30;

export type Trio = { cur: number; prev: number; deltaPct: number | null };
export type Growth = { currency: string; revenue: Trio; orders: Trio; buyers: Trio };

export type GrowthOrder = {
  id: number;
  created_at: string;
  total: number | string | null;
  paid_amount?: number | string | null;
  currency: string | null;
  status: string;
  fulfillment_kind?: string | null;
};

/** Изменение в % к прошлому периоду; null — сравнивать не с чем (в прошлом периоде нуля нет). */
export function trio(cur: number, prev: number): Trio {
  return { cur, prev, deltaPct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null };
}

export function growthOrders(
  rows: readonly GrowthOrder[],
  refunds: ReadonlyMap<number, number>,
  now: Date,
): Pick<Growth, "currency" | "revenue" | "orders"> {
  const edge = now.getTime() - GROWTH_DAYS * 86_400_000;
  const counted = rows.filter(includeOrderInAnalytics);
  const currency =
    dominantCurrency(counted.filter((o) => Date.parse(o.created_at) >= edge)) ??
    dominantCurrency(counted) ??
    "KZT";
  const sum = { cur: 0, prev: 0 };
  const n = { cur: 0, prev: 0 };
  for (const o of counted) {
    if ((o.currency || "—") !== currency) continue;
    const side = Date.parse(o.created_at) >= edge ? "cur" : "prev";
    const refunded = refunds.get(o.id) ?? 0;
    sum[side] += Math.max(0, analyticsRevenue(o) - refunded);
    n[side] += 1;
  }
  return {
    currency,
    revenue: trio(Math.round(sum.cur), Math.round(sum.prev)),
    orders: trio(n.cur, n.prev),
  };
}
