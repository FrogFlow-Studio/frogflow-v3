import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage } from "@/core/db/page";
import { includeOrderInAnalytics } from "./pure";
import { buyerKey } from "./funnel";
import { cohortTable, repeatStats, type CohortRow, type RepeatStats } from "./cohorts";

const MONTHS = 6;

/** Когорты за полгода и повторные покупки (core/analytics/cohorts). */
export async function cohorts(
  ctx: TenantContext,
  now = new Date(),
): Promise<{ rows: CohortRow[]; repeat: RepeatStats }> {
  // С запасом в месяц: первая покупка когорты может быть в начале шестого месяца назад.
  const since = new Date(now.getTime() - (MONTHS + 1) * 31 * 86400_000).toISOString();
  const purchases: Array<{ buyer: string; at: string }> = [];
  await eachPage<{
    user_key: string | null;
    telegram_id: number | string | null;
    created_at: string;
    status: string;
    fulfillment_kind: string | null;
  }>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, user_key, telegram_id, created_at, status, fulfillment_kind")
        .gte("created_at", since)
        .order("created_at")
        .order("id")
        .range(from, to),
    "заказы для когорт",
    (rows) => {
      for (const o of rows)
        if (includeOrderInAnalytics(o))
          purchases.push({ buyer: buyerKey(o.user_key, o.telegram_id), at: o.created_at });
    },
  );
  return {
    rows: cohortTable(purchases, ctx.timezone, { now, months: MONTHS }),
    repeat: repeatStats(purchases),
  };
}
