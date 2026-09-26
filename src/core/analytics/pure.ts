/** Чистая часть аналитики: разбивка по дням, дельты, компактные числа. */

/** Физический заказ в работе: задаток уже внесён, заказ ещё не выдан. */
const PHYSICAL_IN_PROGRESS = new Set(["accepted", "in_production", "ready"]);

/**
 * Какие заказы входят в выручку (как в v1): цифровые — только выданные,
 * физические — ещё и в работе, чтобы внесённый задаток был виден до выдачи.
 */
export function includeOrderInAnalytics(o: {
  status: string;
  fulfillment_kind?: string | null;
}): boolean {
  if (o.status === "delivered") return true;
  return o.fulfillment_kind === "physical" && PHYSICAL_IN_PROGRESS.has(o.status);
}

/** Выручка по одному заказу: выданный — полный total, в работе — внесённое (paid_amount). */
export function analyticsRevenue(o: {
  total: number | string | null;
  status: string;
  fulfillment_kind?: string | null;
  paid_amount?: number | string | null;
}): number {
  if (o.status === "delivered") return Number(o.total) || 0;
  return Number(o.paid_amount) || 0;
}

export type CurrencySummary = { revenue: number; orders: number };

/** Выручка и число заказов по валютам — суммы разных валют не складываются. */
export function summarizeByCurrency(
  orders: Array<{ currency: string | null; revenue: number }>,
): Record<string, CurrencySummary> {
  const out: Record<string, CurrencySummary> = {};
  for (const o of orders) {
    const e = (out[o.currency || "—"] ??= { revenue: 0, orders: 0 });
    e.revenue += o.revenue;
    e.orders += 1;
  }
  return out;
}

/** Валюта, в которой больше всего заказов: в ней плитки, график и топ товаров. */
export function dominantCurrency(orders: Array<{ currency: string | null }>): string | null {
  const counts = new Map<string, number>();
  for (const o of orders) counts.set(o.currency || "—", (counts.get(o.currency || "—") ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [cur, n] of counts)
    if (n > bestCount) {
      best = cur;
      bestCount = n;
    }
  return best;
}

/** Валюты для разбивки: доминирующая первой, остальные по числу заказов, затем по алфавиту. */
export function orderedCurrencies(
  summary: Record<string, CurrencySummary>,
  dominant: string | null,
): string[] {
  return Object.keys(summary).sort((a, b) => {
    if (a === dominant) return -1;
    if (b === dominant) return 1;
    return summary[b]!.orders - summary[a]!.orders || a.localeCompare(b);
  });
}

export type AnalyticsItem = {
  order_id: number;
  product_id: string | null;
  name_snapshot: string | null;
  price_snapshot: number | string | null;
  quantity: number | null;
};

export type TopProduct = { name: string; revenue: number; qty: number; orders: number };

/**
 * Топ товаров по проданному количеству. Выручка — только по заказам из
 * `revenueOrderIds` (одна валюта), у заказа в работе строка масштабируется
 * долей внесённого (paid_amount / total), как сводка. Товар без product_id
 * (удалён) группируется по названию.
 */
export function topProductsBySales(
  items: AnalyticsItem[],
  revenueOrderIds: Set<number>,
  limit = 8,
  revenueScaleByOrderId?: Map<number, number>,
): TopProduct[] {
  const byKey = new Map<string, TopProduct>();
  for (const it of items) {
    const name = it.name_snapshot || "Товар";
    const key = it.product_id ?? `name:${name}`;
    const e = byKey.get(key) ?? { name, revenue: 0, qty: 0, orders: 0 };
    const qty = Number(it.quantity) || 0;
    e.qty += qty;
    e.orders += 1;
    if (revenueOrderIds.has(it.order_id))
      e.revenue +=
        (Number(it.price_snapshot) || 0) * qty * (revenueScaleByOrderId?.get(it.order_id) ?? 1);
    byKey.set(key, e);
  }
  return [...byKey.values()]
    .map((t) => ({ ...t, revenue: Math.round(t.revenue) }))
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, limit);
}

/** YYYY-MM-DD в часовом поясе клиента. */
export function dayKey(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Последние `days` дней, включая сегодня, по возрастанию. */
export function dayKeys(days: number, tz: string, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(new Date(now.getTime() - i * 86400_000), tz));
  return out;
}

export type DayPoint = { day: string; revenue: number; orders: number; customers: number };

export function emptySeries(keys: string[]): DayPoint[] {
  return keys.map((day) => ({ day, revenue: 0, orders: 0, customers: 0 }));
}

/** Процент изменения к прошлому периоду; null — сравнивать не с чем. */
export function pctDelta(current: number, previous: number): number | null {
  if (!(previous > 0)) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** 1 284 → «1,3 тыс.», 4 200 000 → «4,2 млн» — для плиток, не для таблиц. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)} млн`;
  if (abs >= 10_000) return `${trim(n / 1_000)} тыс.`;
  return Math.round(n).toLocaleString("ru");
}
function trim(x: number): string {
  return (Math.round(x * 10) / 10).toLocaleString("ru", { maximumFractionDigits: 1 });
}

/** Красивые деления оси: 0 / 1 000 / 2 000, не больше `max` штук. */
export function niceTicks(maxValue: number, max = 4, integer = false): number[] {
  if (!(maxValue > 0)) return [0];
  const raw = maxValue / max;
  const pow = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  // Штуки не делятся: для счётчиков шаг — целое число, минимум 1.
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + step * 0.999 && ticks.length <= max + 1; v += step) ticks.push(v);
  return ticks;
}

/** «21.09» для оси дат. */
export function shortDay(key: string): string {
  const [, m, d] = key.split("-");
  return `${d}.${m}`;
}
