/** Чистая часть аналитики: разбивка по дням, дельты, компактные числа. */

export const PAID_STATUSES = [
  "delivered",
  "accepted",
  "in_production",
  "ready",
  "completed",
  "paid",
] as const;

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
