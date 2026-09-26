import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import {
  analyticsRevenue,
  dayKey,
  dayKeys,
  dominantCurrency,
  emptySeries,
  includeOrderInAnalytics,
  orderedCurrencies,
  pctDelta,
  summarizeByCurrency,
  topProductsBySales,
  type DayPoint,
  type AnalyticsItem,
  type TopProduct,
} from "./pure";

export type PeriodTotals = {
  revenue: number;
  orders: number;
  avgCheck: number;
  customers: number;
  buyers: number;
};

export type { TopProduct };

export type Analytics = {
  days: number;
  /** Валюта с наибольшим числом заказов: в ней плитки, график, каналы и топ. */
  currency: string;
  /** Выручка текущего периода по каждой валюте, основная первой. */
  byCurrency: Array<{ currency: string; revenue: number; orders: number }>;
  series: DayPoint[];
  current: PeriodTotals;
  previous: PeriodTotals;
  delta: Record<keyof PeriodTotals, number | null>;
  topProducts: TopProduct[];
  byPlatform: Array<{ platform: string; orders: number; revenue: number }>;
  byStatus: Array<{ status: string; orders: number }>;
};

/**
 * Сводка за последние `days` дней с сравнением к предыдущему такому же
 * периоду. Считается в памяти — у одного клиента заказов тысячи, не
 * миллионы, и один проход дешевле шести агрегатных запросов.
 *
 * Как в v1: в выручку идут выданные заказы и физические в работе (с
 * внесённым задатком, paid_amount). Валюты не складываются: плитки, график,
 * каналы и топ — в основной валюте, остальные — отдельной разбивкой.
 */
export async function analytics(ctx: TenantContext, days: number): Promise<Analytics> {
  const now = new Date();
  const tz = ctx.timezone;
  const keys = dayKeys(days, tz, now);
  const firstDay = keys[0]!;
  const since = new Date(now.getTime() - 2 * days * 86400_000).toISOString();

  const [orders, users] = await Promise.all([
    pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select(
            "id, created_at, total, paid_amount, currency, status, fulfillment_kind, platform, telegram_id",
          )
          .gte("created_at", since)
          .order("created_at")
          .range(from, to),
      "заказы для аналитики",
    ),
    pageAll(
      (from, to) =>
        ctx.db
          .from("bot_users")
          .select("created_at")
          .gte("created_at", since)
          .order("created_at")
          .range(from, to),
      "покупатели для аналитики",
    ),
  ]);

  const counted = orders
    .filter((o) => includeOrderInAnalytics(o))
    .map((o) => ({ ...o, day: dayKey(o.created_at, tz), revenue: analyticsRevenue(o) }));
  const currency = dominantCurrency(counted) ?? "KZT";
  const series = emptySeries(keys);
  const byDay = new Map(series.map((p) => [p.day, p]));
  const blank = (): PeriodTotals & { buyerIds: Set<number> } => ({
    revenue: 0,
    orders: 0,
    avgCheck: 0,
    customers: 0,
    buyers: 0,
    buyerIds: new Set(),
  });
  const cur = blank();
  const prev = blank();
  const currentIds: number[] = [];
  const revenueIds = new Set<number>();
  const scale = new Map<number, number>();
  const byPlatform = new Map<string, { orders: number; revenue: number }>();
  const byStatus = new Map<string, number>();

  for (const o of orders)
    if (dayKey(o.created_at, tz) >= firstDay)
      byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);

  const currentCounted = counted.filter((o) => o.day >= firstDay);
  const summary = summarizeByCurrency(currentCounted);
  for (const o of counted) {
    const inCurrent = o.day >= firstDay;
    if (inCurrent) currentIds.push(o.id);
    const bucket = inCurrent ? cur : prev;
    // Покупатель — в любой валюте; деньги и число заказов — в основной.
    bucket.buyerIds.add(Number(o.telegram_id));
    if ((o.currency || "—") !== currency) continue;
    bucket.revenue += o.revenue;
    bucket.orders += 1;
    if (inCurrent) {
      revenueIds.add(o.id);
      const total = Number(o.total) || 0;
      if (total > 0 && o.revenue !== total) scale.set(o.id, o.revenue / total);
      const p = byDay.get(o.day);
      if (p) {
        p.revenue += o.revenue;
        p.orders += 1;
      }
      const platform = o.platform || "telegram";
      const pl = byPlatform.get(platform) ?? { orders: 0, revenue: 0 };
      pl.orders += 1;
      pl.revenue += o.revenue;
      byPlatform.set(platform, pl);
    }
  }
  for (const u of users) {
    const day = dayKey(u.created_at, tz);
    const inCurrent = day >= firstDay;
    (inCurrent ? cur : prev).customers += 1;
    if (inCurrent) {
      const p = byDay.get(day);
      if (p) p.customers += 1;
    }
  }
  const finish = (b: PeriodTotals & { buyerIds: Set<number> }): PeriodTotals => ({
    revenue: Math.round(b.revenue),
    orders: b.orders,
    avgCheck: b.orders ? Math.round(b.revenue / b.orders) : 0,
    customers: b.customers,
    buyers: b.buyerIds.size,
  });
  const current = finish(cur);
  const previous = finish(prev);

  // Топ товаров — по снимкам позиций заказов текущего периода; выручка — в основной валюте.
  const items: AnalyticsItem[] = [];
  for (let i = 0; i < currentIds.length; i += 200) {
    const { data } = await ctx.db
      .from("order_items")
      .select("order_id, product_id, name_snapshot, price_snapshot, quantity")
      .in("order_id", currentIds.slice(i, i + 200));
    items.push(...(data ?? []));
  }

  return {
    days,
    currency,
    byCurrency: orderedCurrencies(summary, currency).map((c) => ({
      currency: c,
      revenue: Math.round(summary[c]!.revenue),
      orders: summary[c]!.orders,
    })),
    series,
    current,
    previous,
    delta: {
      revenue: pctDelta(current.revenue, previous.revenue),
      orders: pctDelta(current.orders, previous.orders),
      avgCheck: pctDelta(current.avgCheck, previous.avgCheck),
      customers: pctDelta(current.customers, previous.customers),
      buyers: pctDelta(current.buyers, previous.buyers),
    },
    topProducts: topProductsBySales(items, revenueIds, 8, scale),
    byPlatform: [...byPlatform.entries()]
      .map(([platform, v]) => ({ platform, ...v, revenue: Math.round(v.revenue) }))
      .sort((a, b) => b.orders - a.orders),
    byStatus: [...byStatus.entries()]
      .map(([status, orders]) => ({ status, orders }))
      .sort((a, b) => b.orders - a.orders),
  };
}
