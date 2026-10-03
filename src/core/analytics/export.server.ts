/** Заказы периода для выгрузки аналитики: постранично, как сводка «Аналитики». */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage, pageAll } from "@/core/db/page";
import { dailyCsv, productsCsv, type ExportOrder } from "./export";
import {
  analyticsRevenue,
  dayKey,
  dayKeys,
  includeOrderInAnalytics,
  type AnalyticsItem,
} from "./pure";

export type AnalyticsExportKind = "daily" | "products";

export async function analyticsCsv(
  ctx: TenantContext,
  kind: AnalyticsExportKind,
  days: number,
  now = new Date(),
): Promise<{ csv: string; count: number }> {
  const tz = ctx.timezone;
  const firstDay = dayKeys(days, tz, now)[0]!;
  // С запасом в сутки назад: границу дня задаёт часовой пояс магазина.
  const since = new Date(now.getTime() - (days + 1) * 86_400_000).toISOString();
  const { netOfRefunds, refundsSince } = await import("@/core/orders/refund");
  const refunds = await refundsSince(ctx, since);
  const orders: ExportOrder[] = [];
  await eachPage<{
    id: number;
    created_at: string;
    total: number | string | null;
    paid_amount: number | string | null;
    currency: string | null;
    status: string;
    fulfillment_kind: string | null;
    platform: string | null;
  }>(
    (a, b) =>
      ctx.db
        .from("orders")
        .select("id, created_at, total, paid_amount, currency, status, fulfillment_kind, platform")
        .gte("created_at", since)
        .order("created_at")
        .order("id")
        .range(a, b),
    "заказы для выгрузки аналитики",
    (rows) => {
      for (const o of rows) {
        const day = dayKey(o.created_at, tz);
        if (day < firstDay || !includeOrderInAnalytics(o)) continue;
        const revenue = netOfRefunds(analyticsRevenue(o), refunds.get(o.id));
        const total = Number(o.total) || 0;
        orders.push({
          id: o.id,
          day,
          platform: o.platform || "telegram",
          currency: o.currency || "—",
          revenue,
          scale: total > 0 && revenue !== total ? revenue / total : 1,
        });
      }
    },
  );
  if (kind === "daily") return dailyCsv(orders);
  const items: AnalyticsItem[] = [];
  for (let i = 0; i < orders.length; i += 200) {
    const chunk = orders.slice(i, i + 200).map((o) => o.id);
    items.push(
      ...(await pageAll<AnalyticsItem>(
        (a, b) =>
          ctx.db
            .from("order_items")
            .select("order_id, product_id, name_snapshot, price_snapshot, quantity")
            .in("order_id", chunk)
            .order("order_id")
            .order("id")
            .range(a, b),
        "позиции заказов для выгрузки аналитики",
      )),
    );
  }
  return productsCsv(orders, items);
}
