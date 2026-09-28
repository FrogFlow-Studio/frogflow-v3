/**
 * Когорты покупателей: покупатель попадает в месяц первой покупки, дальше —
 * доля когорты, купившей снова в месяц +1, +2 … Плюс повторные покупки за
 * всё окно: сколько покупателей купили больше одного раза. Покупка — заказ,
 * который входит в выручку (includeOrderInAnalytics); покупатель — ключ
 * покупателя (user_key, иначе telegram_id), как в воронке.
 */
export type CohortRow = {
  /** Месяц первой покупки, YYYY-MM. */
  month: string;
  size: number;
  /** Доля когорты (0..100), купившей в месяц +1, +2 … — до текущего месяца. */
  retention: number[];
};

export type RepeatStats = { buyers: number; repeat: number; rate: number };

export function monthOf(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number) as [number, number];
  const [yb, mb] = b.split("-").map(Number) as [number, number];
  return (yb - ya) * 12 + (mb - ma);
}

export function cohortTable(
  purchases: Array<{ buyer: string; at: string }>,
  tz: string,
  opts: { now?: Date; months?: number; horizon?: number } = {},
): CohortRow[] {
  const now = monthOf((opts.now ?? new Date()).toISOString(), tz);
  const keep = opts.months ?? 6;
  const horizon = opts.horizon ?? 5;
  const byBuyer = new Map<string, Set<string>>();
  for (const p of purchases) {
    const set = byBuyer.get(p.buyer) ?? new Set<string>();
    set.add(monthOf(p.at, tz));
    byBuyer.set(p.buyer, set);
  }
  const cohorts = new Map<string, Array<Set<string>>>();
  for (const months of byBuyer.values()) {
    const first = [...months].sort()[0]!;
    const list = cohorts.get(first) ?? [];
    list.push(months);
    cohorts.set(first, list);
  }
  return [...cohorts.entries()]
    .filter(([month]) => monthsBetween(month, now) < keep && monthsBetween(month, now) >= 0)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, buyers]) => {
      const span = Math.min(horizon, monthsBetween(month, now));
      const retention: number[] = [];
      for (let k = 1; k <= span; k++) {
        const hit = buyers.filter((ms) =>
          [...ms].some((m) => monthsBetween(month, m) === k),
        ).length;
        retention.push(Math.round((hit / buyers.length) * 100));
      }
      return { month, size: buyers.length, retention };
    });
}

export function repeatStats(purchases: Array<{ buyer: string }>): RepeatStats {
  const count = new Map<string, number>();
  for (const p of purchases) count.set(p.buyer, (count.get(p.buyer) ?? 0) + 1);
  const buyers = count.size;
  const repeat = [...count.values()].filter((n) => n > 1).length;
  return { buyers, repeat, rate: buyers ? Math.round((repeat / buyers) * 100) : 0 };
}
