import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { PAID_STATUSES, dayKey, dayKeys, emptySeries, pctDelta, type DayPoint } from "./pure";

export type PeriodTotals = {
  revenue: number;
  orders: number;
  avgCheck: number;
  customers: number;
  buyers: number;
};

export type TopProduct = { name: string; revenue: number; qty: number; orders: number };

export type Analytics = {
  days: number;
  currency: string;
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
 * периоду. Считается в памяти по оплаченным заказам — у одного клиента их
 * тысячи, не миллионы, и один проход дешевле шести агрегатных запросов.
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
          .select("id, created_at, total, currency, status, platform, telegram_id")
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

  const paid = new Set<string>(PAID_STATUSES);
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
  let currency = "KZT";
  const currentIds: number[] = [];
  const byPlatform = new Map<string, { orders: number; revenue: number }>();
  const byStatus = new Map<string, number>();

  for (const o of orders) {
    const day = dayKey(o.created_at, tz);
    const inCurrent = day >= firstDay;
    if (inCurrent) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    if (!paid.has(o.status)) continue;
    const total = Number(o.total) || 0;
    currency = o.currency || currency;
    const bucket = inCurrent ? cur : prev;
    bucket.revenue += total;
    bucket.orders += 1;
    bucket.buyerIds.add(Number(o.telegram_id));
    if (inCurrent) {
      currentIds.push(o.id);
      const p = byDay.get(day);
      if (p) {
        p.revenue += total;
        p.orders += 1;
      }
      const platform = o.platform || "telegram";
      const pl = byPlatform.get(platform) ?? { orders: 0, revenue: 0 };
      pl.orders += 1;
      pl.revenue += total;
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

  // Топ товаров — по снимкам позиций оплаченных заказов текущего периода.
  const top = new Map<string, TopProduct>();
  for (let i = 0; i < currentIds.length; i += 200) {
    const { data } = await ctx.db
      .from("order_items")
      .select("order_id, name_snapshot, price_snapshot, quantity")
      .in("order_id", currentIds.slice(i, i + 200));
    for (const it of data ?? []) {
      const name = it.name_snapshot || "Товар";
      const t = top.get(name) ?? { name, revenue: 0, qty: 0, orders: 0 };
      const qty = Number(it.quantity) || 1;
      t.revenue += (Number(it.price_snapshot) || 0) * qty;
      t.qty += qty;
      t.orders += 1;
      top.set(name, t);
    }
  }

  return {
    days,
    currency,
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
    topProducts: [...top.values()]
      .map((t) => ({ ...t, revenue: Math.round(t.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8),
    byPlatform: [...byPlatform.entries()]
      .map(([platform, v]) => ({ platform, ...v, revenue: Math.round(v.revenue) }))
      .sort((a, b) => b.orders - a.orders),
    byStatus: [...byStatus.entries()]
      .map(([status, orders]) => ({ status, orders }))
      .sort((a, b) => b.orders - a.orders),
  };
}
