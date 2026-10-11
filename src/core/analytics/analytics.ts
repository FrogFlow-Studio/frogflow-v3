import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage, pageAll } from "@/core/db/page";
import {
  analyticsRevenue,
  dayKey,
  dayKeys,
  emptySeries,
  includeOrderInAnalytics,
  orderedCurrencies,
  pctDelta,
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
  /** Основная валюта магазина: в ней плитки, график, каналы и топ (другие — по курсу). */
  currency: string;
  /**
   * Выручка текущего периода в исходных валютах заказов, основная первой.
   * `inBase` — та же сумма в основной валюте по курсу; null — курса нет,
   * эта валюта в плитки не вошла.
   */
  byCurrency: Array<{ currency: string; revenue: number; orders: number; inBase: number | null }>;
  series: DayPoint[];
  current: PeriodTotals;
  previous: PeriodTotals;
  delta: Record<keyof PeriodTotals, number | null>;
  topProducts: TopProduct[];
  byPlatform: Array<{ platform: string; orders: number; revenue: number }>;
  byStatus: Array<{ status: string; orders: number }>;
};

type Money = { revenue: number; orders: number };
type Acc = {
  cur: Money;
  prev: Money;
  byDay: Map<string, Money>;
  byPlatform: Map<string, Money>;
  /** Заказы текущего периода в этой валюте — для топа товаров. */
  ids: number[];
  scale: Map<number, number>;
};

const blankAcc = (): Acc => ({
  cur: { revenue: 0, orders: 0 },
  prev: { revenue: 0, orders: 0 },
  byDay: new Map(),
  byPlatform: new Map(),
  ids: [],
  scale: new Map(),
});

const add = (m: Map<string, Money>, k: string, revenue: number) => {
  const e = m.get(k) ?? { revenue: 0, orders: 0 };
  e.revenue += revenue;
  e.orders += 1;
  m.set(k, e);
};

/**
 * Сводка за последние `days` дней с сравнением к предыдущему такому же
 * периоду. Заказы читаются постранично и сразу складываются в суммы по
 * валютам: в памяти не держим строки заказов, только итоги и номера
 * заказов текущего периода (для топа товаров).
 *
 * Как в v1: в выручку идут выданные заказы и физические в работе (с
 * внесённым задатком, paid_amount). Заказы в других валютах пересчитываются в
 * основную валюту магазина по курсу на сегодня (core/money/shop-fx), исходные
 * суммы видны разбивкой по валютам; валюта без курса в плитки не входит.
 */
export async function analytics(ctx: TenantContext, days: number): Promise<Analytics> {
  const now = new Date();
  const tz = ctx.timezone;
  const keys = dayKeys(days, tz, now);
  const firstDay = keys[0]!;
  const since = new Date(now.getTime() - 2 * days * 86400_000).toISOString();

  const accs = new Map<string, Acc>();
  const buyers = { cur: new Set<number>(), prev: new Set<number>() };
  const byStatus = new Map<string, number>();
  const customers = { cur: 0, prev: 0, byDay: new Map<string, number>() };
  // Возвраты (core/orders/refund) уменьшают выручку заказа.
  const { netOfRefunds, refundsSince } = await import("@/core/orders/refund");
  const { loadShopFx } = await import("@/core/money/shop-fx");
  const [refunds, fx] = await Promise.all([refundsSince(ctx, since), loadShopFx(ctx)]);
  /** Текущий период в исходных валютах — для разбивки под плитками. */
  const original = new Map<string, { revenue: number; orders: number; inBase: number | null }>();

  await Promise.all([
    eachPage(
      (from, to) =>
        ctx.db
          .from("orders")
          .select(
            "id, created_at, total, paid_amount, currency, status, fulfillment_kind, platform, telegram_id",
          )
          .gte("created_at", since)
          .order("created_at")
          .order("id")
          .range(from, to),
      "заказы для аналитики",
      (rows) => {
        for (const o of rows) {
          const day = dayKey(o.created_at, tz);
          const inCurrent = day >= firstDay;
          if (inCurrent) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
          if (!includeOrderInAnalytics(o)) continue;
          const own = netOfRefunds(analyticsRevenue(o), refunds.get(o.id));
          // Покупатель — в любой валюте; деньги — в основной по курсу, без курса — в своей.
          (inCurrent ? buyers.cur : buyers.prev).add(Number(o.telegram_id));
          const k = fx.factor(o.currency);
          const revenue = own * (k ?? 1);
          const cur = k == null ? o.currency || "—" : fx.base;
          if (inCurrent) {
            const ownCur = (o.currency || fx.base).toUpperCase();
            const e = original.get(ownCur) ?? { revenue: 0, orders: 0, inBase: 0 };
            e.revenue += own;
            e.orders += 1;
            e.inBase = k == null ? null : (e.inBase ?? 0) + revenue;
            original.set(ownCur, e);
          }
          const acc = accs.get(cur) ?? blankAcc();
          accs.set(cur, acc);
          const bucket = inCurrent ? acc.cur : acc.prev;
          bucket.revenue += revenue;
          bucket.orders += 1;
          if (!inCurrent) continue;
          acc.ids.push(o.id);
          const total = Number(o.total) || 0;
          if (total > 0 && revenue !== total) acc.scale.set(o.id, revenue / total);
          add(acc.byDay, day, revenue);
          add(acc.byPlatform, o.platform || "telegram", revenue);
        }
      },
    ),
    eachPage(
      (from, to) =>
        ctx.db
          .from("bot_users")
          .select("created_at")
          .gte("created_at", since)
          .order("created_at")
          .order("user_key")
          .range(from, to),
      "покупатели для аналитики",
      (rows) => {
        for (const u of rows) {
          const day = dayKey(u.created_at, tz);
          if (day >= firstDay) {
            customers.cur += 1;
            customers.byDay.set(day, (customers.byDay.get(day) ?? 0) + 1);
          } else customers.prev += 1;
        }
      },
    ),
  ]);

  // Основная валюта — валюта магазина: в неё пересчитано всё, у чего есть курс.
  const currency = fx.base;
  const main = accs.get(currency) ?? blankAcc();

  const series = emptySeries(keys);
  for (const p of series) {
    const m = main.byDay.get(p.day);
    if (m) {
      p.revenue = m.revenue;
      p.orders = m.orders;
    }
    p.customers = customers.byDay.get(p.day) ?? 0;
  }
  const finish = (m: Money, customersN: number, buyerIds: Set<number>): PeriodTotals => ({
    revenue: Math.round(m.revenue),
    orders: m.orders,
    avgCheck: m.orders ? Math.round(m.revenue / m.orders) : 0,
    customers: customersN,
    buyers: buyerIds.size,
  });
  const current = finish(main.cur, customers.cur, buyers.cur);
  const previous = finish(main.prev, customers.prev, buyers.prev);
  const summary: Record<string, { revenue: number; orders: number }> = {};
  for (const [c, e] of original) summary[c] = e;

  // Топ товаров — по снимкам позиций заказов текущего периода в основной валюте.
  // Кусками по 200 заказов и постранично: позиций у 200 заказов бывает больше 1000.
  const items: AnalyticsItem[] = [];
  for (let i = 0; i < main.ids.length; i += 200) {
    const chunk = main.ids.slice(i, i + 200);
    items.push(
      ...(await pageAll(
        (from, to) =>
          ctx.db
            .from("order_items")
            .select("order_id, product_id, name_snapshot, price_snapshot, quantity")
            .in("order_id", chunk)
            .order("order_id")
            .order("id")
            .range(from, to),
        "позиции заказов для аналитики",
      )),
    );
  }
  const revenueIds = new Set(main.ids);
  const scale = main.scale;
  const byPlatform = main.byPlatform;

  return {
    days,
    currency,
    byCurrency: orderedCurrencies(summary, currency).map((c) => ({
      currency: c,
      revenue: Math.round(summary[c]!.revenue),
      orders: summary[c]!.orders,
      inBase: original.get(c)!.inBase == null ? null : Math.round(original.get(c)!.inBase!),
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
