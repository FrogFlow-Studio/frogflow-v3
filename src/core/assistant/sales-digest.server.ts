/** Сводка двух периодов для «Почему изменились продажи»: те же расчёты, что на странице «Аналитика». */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { analytics } from "@/core/analytics/analytics";
import { customersBlock } from "@/core/analytics/customers.server";
import { autoShare, type SpeedRow } from "@/core/analytics/speed";
import { speedStats } from "@/core/analytics/speed.server";
import type { SalesDigest, SalesSpeed } from "./prompts";

const round = (v: number | null) => (v === null ? null : Math.round(v));

export function speedOf(rows: SpeedRow[]): SalesSpeed {
  const all = rows[0];
  if (!all || !all.placed)
    return { payMedian: null, payP90: null, deliverMedian: null, autoShare: null };
  return {
    payMedian: round(all.pay.median),
    payP90: round(all.pay.p90),
    deliverMedian: round(all.deliver.median),
    autoShare: autoShare(all),
  };
}

export async function salesDigest(
  ctx: TenantContext,
  days: number,
  now = new Date(),
): Promise<SalesDigest> {
  const from = new Date(now.getTime() - days * 86_400_000);
  const prevFrom = new Date(now.getTime() - 2 * days * 86_400_000);
  const [a, speed, speedPrev, customers] = await Promise.all([
    analytics(ctx, days),
    speedStats(ctx, from, now),
    speedStats(ctx, prevFrom, from, now),
    customersBlock(ctx, days, now),
  ]);
  // Недели периода: покупатели недель, целиком или частично попавших в него.
  const weeks = customers.weeks.slice(-Math.ceil(days / 7));
  return {
    days,
    currency: a.currency,
    current: a.current,
    previous: a.previous,
    currentSpeed: speedOf(speed),
    previousSpeed: speedOf(speedPrev),
    byChannel: a.byPlatform.map((p) => ({
      channel: p.platform,
      orders: p.orders,
      revenue: p.revenue,
    })),
    topProducts: a.topProducts.map((p) => ({ name: p.name, qty: p.qty, revenue: p.revenue })),
    buyers: {
      fresh: weeks.reduce((s, w) => s + w.fresh, 0),
      returning: weeks.reduce((s, w) => s + w.returning, 0),
      dormant: customers.dormant.count,
    },
  };
}
