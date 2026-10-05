/** Покупатели за год: постраничное чтение заказов, имена топа и счёт в core/analytics/customers. */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import { buyerKey } from "./funnel";
import { analyticsRevenue, includeOrderInAnalytics } from "./pure";
import { customersReport, type CustomersReport, type Purchase } from "./customers";

const WINDOW_DAYS = 365;
const CHUNK = 200;

export type CustomersBlock = Omit<CustomersReport, "top"> & {
  top: Array<CustomersReport["top"][number] & { name: string }>;
};

/** Покупки за год (заказы, входящие в выручку, за вычетом возвратов) — постранично. */
export async function readPurchases(ctx: TenantContext, now = new Date()): Promise<Purchase[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const { netOfRefunds, refundsSince } = await import("@/core/orders/refund");
  const refunds = await refundsSince(ctx, since);
  const purchases: Purchase[] = [];
  await eachPage<{
    id: number;
    user_key: string | null;
    telegram_id: number | string | null;
    created_at: string;
    total: number | string | null;
    paid_amount: number | string | null;
    currency: string | null;
    status: string;
    fulfillment_kind: string | null;
  }>(
    (a, b) =>
      ctx.db
        .from("orders")
        .select(
          "id, user_key, telegram_id, created_at, total, paid_amount, currency, status, fulfillment_kind",
        )
        .gte("created_at", since)
        .order("created_at")
        .order("id")
        .range(a, b),
    "заказы для отчёта о покупателях",
    (rows) => {
      for (const o of rows) {
        if (!includeOrderInAnalytics(o)) continue;
        purchases.push({
          buyer: buyerKey(o.user_key, o.telegram_id),
          at: o.created_at,
          amount: netOfRefunds(analyticsRevenue(o), refunds.get(o.id)),
          currency: o.currency || "—",
        });
      }
    },
  );
  return purchases;
}

export async function customersBlock(
  ctx: TenantContext,
  days: number,
  now = new Date(),
): Promise<CustomersBlock> {
  const purchases = await readPurchases(ctx, now);
  const weeks = Math.max(4, Math.ceil(days / 7));
  const report = customersReport(purchases, ctx.timezone, { now, weeks, days });
  const names = new Map<string, string>();
  const keys = report.top.map((t) => t.buyer);
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data, error } = await ctx.db
      .from("bot_users")
      .select("user_key, first_name, last_name, username")
      .in("user_key", keys.slice(i, i + CHUNK))
      .order("user_key");
    if (error) throw serverFailure(`Покупатели для отчёта: имена: ${error.message}`);
    for (const u of data ?? [])
      names.set(
        u.user_key,
        [u.first_name, u.last_name].filter(Boolean).join(" ") ||
          (u.username ? `@${u.username}` : ""),
      );
  }
  return { ...report, top: report.top.map((t) => ({ ...t, name: names.get(t.buyer) ?? "" })) };
}
