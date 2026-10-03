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

export type CustomersReport = {
  weeks: WeekRow[];
  /** Валюта рейтинга — та, в которой больше всего покупок. */
  currency: string | null;
  top: TopBuyer[];
  dormant: { count: number; days: number };
};

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
  opts: { now?: Date; weeks: number },
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
    currency,
    top,
    dormant: { count: dormant, days: DORMANT_DAYS },
  };
}
