import { eachPage } from "@/core/db/page";
import { analytics } from "@/core/analytics/analytics";
import { dayKey, dayKeys, includeOrderInAnalytics, pctDelta } from "@/core/analytics/pure";
import { toCsv } from "@/core/export/csv";
import { refundsSince } from "@/core/orders/refund";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Центр отчётов: продажи, прибыль, склад, баллы, рассылки, отказы за период
 * с сравнением с таким же прошлым. Продажи и прибыль берутся из тех же
 * функций, что страницы «Аналитика» и «Прибыль» (`analytics`, `profitReport`):
 * суммы совпадают, второго подсчёта нет. Только чтение.
 */
export const REPORT_KINDS = [
  "sales",
  "profit",
  "stock",
  "points",
  "broadcasts",
  "refusals",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_PERIODS = [7, 30, 90] as const;

export type Metric = {
  /** Ключ подписи (`reports.m.<key>`). */
  key: string;
  current: number;
  /** Прошлый период; null — сравнивать не с чем (срез на сегодня). */
  previous: number | null;
  /** Валюта, если это деньги. */
  currency?: string;
};
export type ReportTable = { columns: string[]; rows: Array<Array<string | number>> };
export type CenterReport = {
  kind: ReportKind;
  days: number;
  metrics: Metric[];
  /** Подписи колонок таблицы — ключи `reports.c.<key>`. */
  table: ReportTable | null;
};

export const delta = (m: Metric): number | null =>
  m.previous === null ? null : pctDelta(m.current, m.previous);

/** Какие отчёты видит роль и при каких модулях. Бухгалтер — деньги и заказы, без рассылок и покупателей. */
export function availableReports(
  modules: Partial<Record<string, boolean>>,
  accountant: boolean,
): ReportKind[] {
  return REPORT_KINDS.filter((k) => {
    if (k === "profit") return Boolean(modules.profit);
    if (k === "stock") return Boolean(modules.stock) && !accountant;
    if (k === "points") return Boolean(modules.loyalty);
    if (k === "broadcasts") return Boolean(modules.broadcasts) && !accountant;
    return true;
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function sales(ctx: TenantContext, days: number): Promise<CenterReport> {
  const a = await analytics(ctx, days);
  const m = (key: string, c: number, p: number, money = false): Metric => ({
    key,
    current: c,
    previous: p,
    ...(money ? { currency: a.currency } : {}),
  });
  return {
    kind: "sales",
    days,
    metrics: [
      m("revenue", a.current.revenue, a.previous.revenue, true),
      m("orders", a.current.orders, a.previous.orders),
      m("avgCheck", a.current.avgCheck, a.previous.avgCheck, true),
      m("buyers", a.current.buyers, a.previous.buyers),
    ],
    table: {
      columns: ["platform", "orders", "revenue"],
      rows: a.byPlatform.map((p) => [p.platform, p.orders, round2(p.revenue)]),
    },
  };
}

async function profit(ctx: TenantContext, days: number, now: Date): Promise<CenterReport> {
  const { profitReport } = await import("@/core/profit/report");
  const [cur, prev] = await Promise.all([
    profitReport(ctx, days, now),
    profitReport(ctx, days, new Date(now.getTime() - days * 86400_000)),
  ]);
  return {
    kind: "profit",
    days,
    metrics: [
      { key: "revenue", current: cur.revenue, previous: prev.revenue, currency: cur.currency },
      { key: "cost", current: cur.cost, previous: prev.cost, currency: cur.currency },
      { key: "profit", current: cur.profit, previous: prev.profit, currency: cur.currency },
      { key: "orders", current: cur.orders, previous: prev.orders },
    ],
    table: {
      columns: ["product", "qty", "revenue", "profit"],
      rows: cur.products.map((p) => [p.name, p.qty, round2(p.revenue), round2(p.profit ?? 0)]),
    },
  };
}

async function stock(ctx: TenantContext, days: number): Promise<CenterReport> {
  const { listLowStock } = await import("@/core/catalog/low-stock");
  const low = await listLowStock(ctx);
  return {
    kind: "stock",
    days,
    metrics: [{ key: "lowStock", current: low.length, previous: null }],
    table: {
      columns: ["product", "stock", "threshold"],
      rows: low.map((p) => [p.name, p.stock, p.threshold]),
    },
  };
}

type Orders = Array<{
  id: number;
  created_at: string;
  status: string;
  total: number | string | null;
  paid_amount: number | string | null;
  fulfillment_kind: string | null;
  points_earned: number | null;
  points_used: number | null;
}>;

/** Заказы за два периода одним проходом: текущий и такой же прошлый, постранично. */
async function eachOrder(
  ctx: TenantContext,
  days: number,
  now: Date,
  visit: (o: Orders[number], current: boolean) => void,
): Promise<void> {
  const tz = ctx.timezone;
  const firstDay = dayKeys(days, tz, now)[0]!;
  const since = new Date(now.getTime() - 2 * days * 86400_000).toISOString();
  await eachPage<Orders[number]>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select(
          "id, created_at, status, total, paid_amount, fulfillment_kind, points_earned, points_used",
        )
        .gte("created_at", since)
        .order("created_at")
        .order("id")
        .range(from, to),
    "Отчёты: заказы",
    (rows) => {
      for (const o of rows) visit(o, dayKey(o.created_at, tz) >= firstDay);
    },
  );
}

async function points(ctx: TenantContext, days: number, now: Date): Promise<CenterReport> {
  const cur = { earned: 0, used: 0 };
  const prev = { earned: 0, used: 0 };
  // Баллы только из учтённых (оплаченных) заказов, как выручка в «Аналитике»; здесь они не пересчитываются.
  await eachOrder(ctx, days, now, (o, current) => {
    if (!includeOrderInAnalytics(o)) return;
    const b = current ? cur : prev;
    b.earned += Number(o.points_earned) || 0;
    b.used += Number(o.points_used) || 0;
  });
  return {
    kind: "points",
    days,
    metrics: [
      { key: "pointsEarned", current: cur.earned, previous: prev.earned },
      { key: "pointsUsed", current: cur.used, previous: prev.used },
    ],
    table: null,
  };
}

async function refusals(ctx: TenantContext, days: number, now: Date): Promise<CenterReport> {
  const since = new Date(now.getTime() - 2 * days * 86400_000).toISOString();
  const refunds = await refundsSince(ctx, since);
  const cur = { rejected: 0, cancelled: 0, refunded: 0, refundSum: 0 };
  const prev = { ...cur };
  await eachOrder(ctx, days, now, (o, current) => {
    const b = current ? cur : prev;
    if (o.status === "rejected") b.rejected += 1;
    if (o.status === "cancelled") b.cancelled += 1;
    const r = refunds.get(o.id);
    if (r) {
      b.refunded += 1;
      b.refundSum += r;
    }
  });
  const { getSettings } = await import("@/core/settings/settings");
  const currency = (
    (await getSettings(ctx, ["shop_currency"])).shop_currency ?? "KZT"
  ).toUpperCase();
  return {
    kind: "refusals",
    days,
    metrics: [
      { key: "rejected", current: cur.rejected, previous: prev.rejected },
      { key: "cancelled", current: cur.cancelled, previous: prev.cancelled },
      { key: "refunded", current: cur.refunded, previous: prev.refunded },
      {
        key: "refundSum",
        current: round2(cur.refundSum),
        previous: round2(prev.refundSum),
        currency,
      },
    ],
    table: null,
  };
}

async function broadcasts(ctx: TenantContext, days: number, now: Date): Promise<CenterReport> {
  const tz = ctx.timezone;
  const firstDay = dayKeys(days, tz, now)[0]!;
  const since = new Date(now.getTime() - 2 * days * 86400_000).toISOString();
  const cur = { count: 0, sent: 0, failed: 0, blocked: 0 };
  const prev = { ...cur };
  await eachPage<{
    created_at: string;
    sent_count: number;
    failed_count: number;
    blocked_count: number;
  }>(
    (from, to) =>
      ctx.db
        .from("broadcasts")
        .select("id, created_at, sent_count, failed_count, blocked_count")
        .eq("status", "completed")
        .gte("created_at", since)
        .order("created_at")
        .order("id")
        .range(from, to),
    "Отчёты: рассылки",
    (rows) => {
      for (const r of rows) {
        const b = dayKey(r.created_at, tz) >= firstDay ? cur : prev;
        b.count += 1;
        b.sent += Number(r.sent_count) || 0;
        b.failed += Number(r.failed_count) || 0;
        b.blocked += Number(r.blocked_count) || 0;
      }
    },
  );
  return {
    kind: "broadcasts",
    days,
    metrics: [
      { key: "bcCount", current: cur.count, previous: prev.count },
      { key: "bcSent", current: cur.sent, previous: prev.sent },
      { key: "bcFailed", current: cur.failed, previous: prev.failed },
      { key: "bcBlocked", current: cur.blocked, previous: prev.blocked },
    ],
    table: null,
  };
}

export async function centerReport(
  ctx: TenantContext,
  kind: ReportKind,
  days: number,
  now = new Date(),
): Promise<CenterReport> {
  switch (kind) {
    case "sales":
      return sales(ctx, days);
    case "profit":
      return profit(ctx, days, now);
    case "stock":
      return stock(ctx, days);
    case "points":
      return points(ctx, days, now);
    case "broadcasts":
      return broadcasts(ctx, days, now);
    case "refusals":
      return refusals(ctx, days, now);
  }
}

/** CSV отчёта: сводка и таблица; подписи на языке продавца; значения защищены от формул (`cell`). */
export function reportCsv(
  r: CenterReport,
  label: (kind: "m" | "c", key: string) => string,
  head: { metric: string; current: string; previous: string; change: string },
): { csv: string; count: number } {
  const rows: unknown[][] = r.metrics.map((m) => [
    label("m", m.key),
    m.current,
    m.previous ?? "",
    delta(m) ?? "",
  ]);
  const summary = toCsv([head.metric, head.current, head.previous, head.change], rows);
  if (!r.table || r.table.rows.length === 0) return { csv: summary, count: rows.length };
  const table = toCsv(
    r.table.columns.map((c) => label("c", c)),
    r.table.rows,
  );
  // Вторая таблица идёт через пустую строку, без повторного BOM.
  return { csv: `${summary}\r\n\r\n${table.slice(1)}`, count: rows.length + r.table.rows.length };
}
