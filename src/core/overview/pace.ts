/**
 * «Сегодня» на главной (Ж3): продажи за сегодня к тому же времени вчера и по часам.
 * Чистый расчёт по строкам заказов, которые уже считает аналитика (выданные и
 * физические в работе с задатком); день и час — по часовому поясу магазина.
 */
import { analyticsRevenue, dominantCurrency, includeOrderInAnalytics } from "@/core/analytics/pure";

export type PaceOrder = {
  created_at: string;
  total: number | string | null;
  paid_amount?: number | string | null;
  currency: string | null;
  status: string;
  fulfillment_kind?: string | null;
};

export type SalesPace = {
  currency: string;
  /** Выручка за сегодня на этот час. */
  today: number;
  /** Выручка вчера до этого же часа и минуты. */
  yesterdaySoFar: number;
  orders: number;
  /** Сегодня по часам, 24 значения. */
  byHour: number[];
  /** Сегодня к вчера, %; `null` — вчера продаж не было, сравнивать не с чем. */
  deltaPct: number | null;
};

/** Окно чтения: вчера целиком и сегодня — не больше 48 часов, с запасом на пояс. */
export const PACE_WINDOW_MS = 50 * 3_600_000;

function local(d: Date, tz: string): { day: string; minutes: number; hour: number } {
  const day = d.toLocaleDateString("en-CA", { timeZone: tz });
  const [h, m] = d
    .toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    })
    .split(":")
    .map((x) => Number(x) % 24);
  return { day, minutes: h! * 60 + m!, hour: h! };
}

export function salesPace(rows: readonly PaceOrder[], now: Date, tz: string): SalesPace {
  const counted = rows.filter((o) => includeOrderInAnalytics(o));
  const currency = dominantCurrency(counted) ?? "KZT";
  const here = local(now, tz);
  const yesterday = local(new Date(now.getTime() - 86_400_000), tz).day;
  const byHour = Array.from({ length: 24 }, () => 0);
  let today = 0;
  let yesterdaySoFar = 0;
  let orders = 0;
  for (const o of counted) {
    if ((o.currency || "—") !== currency) continue;
    const at = local(new Date(o.created_at), tz);
    const amount = analyticsRevenue(o);
    if (at.day === here.day) {
      today += amount;
      byHour[at.hour]! += amount;
      orders += 1;
    } else if (at.day === yesterday && at.minutes <= here.minutes) yesterdaySoFar += amount;
  }
  today = Math.round(today);
  yesterdaySoFar = Math.round(yesterdaySoFar);
  return {
    currency,
    today,
    yesterdaySoFar,
    orders,
    byHour: byHour.map((v) => Math.round(v)),
    deltaPct:
      yesterdaySoFar > 0 ? Math.round(((today - yesterdaySoFar) / yesterdaySoFar) * 100) : null,
  };
}
