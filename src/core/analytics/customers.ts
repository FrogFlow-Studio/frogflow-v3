/**
 * Покупатели в аналитике: новые и вернувшиеся по неделям, топ по сумме
 * покупок и «уснувшие» (две и больше покупок, но давно ничего). Чистая часть,
 * без базы. Покупка — заказ, входящий в выручку (includeOrderInAnalytics),
 * сумма — за вычетом возвратов; покупатель — ключ как в воронке.
 */
import { dayKey } from "./pure";

export type Purchase = {
  buyer: string;
  at: string;
  amount: number;
  currency: string;
};

export type WeekRow = { week: string; fresh: number; returning: number };

export type TopBuyer = { buyer: string; amount: number; orders: number };

/** Покупатели периода: новые и вернувшиеся, их доля и средний чек (У3). */
export type ReturningStats = {
  /** Покупателей с оплатой в периоде; 0 — «пока нет данных». */
  buyers: number;
  /** Из них вернувшиеся: первая покупка раньше начала периода. */
  returning: number;
  /** Доля вернувшихся, %; null, пока покупателей нет. */
  share: number | null;
  /** Валюта среднего чека — та, в которой больше покупок периода. */
  currency: string | null;
  fresh: { buyers: number; orders: number; avg: number | null };
  back: { buyers: number; orders: number; avg: number | null };
};

export type CustomersReport = {
  weeks: WeekRow[];
  period: ReturningStats;
  /** Валюта рейтинга — та, в которой больше всего покупок. */
  currency: string | null;
  top: TopBuyer[];
  dormant: { count: number; days: number };
};

/**
 * «Вернулись покупатели» за последние `days` суток (У3). `purchases` — только
 * оплаченные заказы (readPurchases отсеивает остальные), вся доступная
 * история: первая покупка до начала периода делает покупателя вернувшимся.
 * Средний чек — по заказам периода в одной валюте, суммы валют не смешиваются.
 */
export function returningStats(purchases: Purchase[], days: number, now: Date): ReturningStats {
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  const to = now.toISOString();
  const firstAt = new Map<string, string>();
  for (const p of purchases) {
    const cur = firstAt.get(p.buyer);
    if (!cur || p.at < cur) firstAt.set(p.buyer, p.at);
  }
  const inPeriod = purchases.filter((p) => p.at >= from && p.at <= to);
  const counts = new Map<string, number>();
  for (const p of inPeriod) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  const currency =
    [...counts.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0] ?? null;
  const group = () => ({ buyers: new Set<string>(), orders: 0, sum: 0 });
  const fresh = group();
  const back = group();
  for (const p of inPeriod) {
    const g = (firstAt.get(p.buyer) ?? p.at) >= from ? fresh : back;
    g.buyers.add(p.buyer);
    if (p.currency === currency) {
      g.orders += 1;
      g.sum += p.amount;
    }
  }
  const pack = (g: ReturnType<typeof group>) => ({
    buyers: g.buyers.size,
    orders: g.orders,
    avg: g.orders ? Math.round((g.sum / g.orders) * 100) / 100 : null,
  });
  const buyers = fresh.buyers.size + back.buyers.size;
  return {
    buyers,
    returning: back.buyers.size,
    share: buyers ? Math.round((back.buyers.size / buyers) * 100) : null,
    currency,
    fresh: pack(fresh),
    back: pack(back),
  };
}

export const DORMANT_DAYS = 60;
export const TOP_BUYERS = 20;

/** Понедельник недели (YYYY-MM-DD) для момента времени в часовом поясе магазина. */
export function weekStart(iso: string | Date, tz: string): string {
  const day = dayKey(iso, tz);
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Последние `count` недель, включая текущую, по возрастанию. */
export function lastWeeks(count: number, tz: string, now: Date): string[] {
  const out: string[] = [];
  const cur = new Date(`${weekStart(now, tz)}T00:00:00Z`);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(cur);
    d.setUTCDate(d.getUTCDate() - i * 7);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * `purchases` — вся доступная история (окно чтения). «Новый» в неделе —
 * покупатель, у которого первая покупка окна попала в эту неделю;
 * «вернувшийся» — купил в неделе, а первая покупка была раньше.
 */
export function customersReport(
  purchases: Purchase[],
  tz: string,
  opts: { now?: Date; weeks: number; days?: number },
): CustomersReport {
  const now = opts.now ?? new Date();
  const byBuyer = new Map<string, Purchase[]>();
  for (const p of purchases) {
    const list = byBuyer.get(p.buyer) ?? [];
    list.push(p);
    byBuyer.set(p.buyer, list);
  }
  const keys = lastWeeks(opts.weeks, tz, now);
  const rows = new Map<string, WeekRow>(
    keys.map((week) => [week, { week, fresh: 0, returning: 0 }]),
  );
  for (const list of byBuyer.values()) {
    const first = list.reduce((m, p) => (p.at < m ? p.at : m), list[0]!.at);
    const firstWeek = weekStart(first, tz);
    const seen = new Set<string>();
    for (const p of list) {
      const w = weekStart(p.at, tz);
      const row = rows.get(w);
      if (!row || seen.has(w)) continue;
      seen.add(w);
      if (w === firstWeek) row.fresh += 1;
      else row.returning += 1;
    }
  }

  const counts = new Map<string, number>();
  for (const p of purchases) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  const currency =
    [...counts.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0] ?? null;
  const sums = new Map<string, TopBuyer>();
  for (const p of purchases) {
    if (p.currency !== currency) continue;
    const e = sums.get(p.buyer) ?? { buyer: p.buyer, amount: 0, orders: 0 };
    e.amount += p.amount;
    e.orders += 1;
    sums.set(p.buyer, e);
  }
  const top = [...sums.values()]
    .sort((a, b) => b.amount - a.amount || b.orders - a.orders || a.buyer.localeCompare(b.buyer))
    .slice(0, TOP_BUYERS)
    .map((e) => ({ ...e, amount: Math.round(e.amount * 100) / 100 }));

  const edge = now.getTime() - DORMANT_DAYS * 86_400_000;
  let dormant = 0;
  for (const list of byBuyer.values()) {
    if (list.length < 2) continue;
    const last = Math.max(...list.map((p) => Date.parse(p.at)));
    if (last < edge) dormant += 1;
  }
  return {
    weeks: [...rows.values()],
    period: returningStats(purchases, opts.days ?? 30, now),
    currency,
    top,
    dormant: { count: dormant, days: DORMANT_DAYS },
  };
}
