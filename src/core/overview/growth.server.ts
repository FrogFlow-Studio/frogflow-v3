import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { GROWTH_DAYS, growthOrders, trio, type Growth, type GrowthOrder } from "./growth";

/** Заказы за 60 суток постранично, возвраты и число новых покупателей; сбой чтения — сбой, а не «роста нет». */
export async function loadGrowth(ctx: TenantContext, now = new Date()): Promise<Growth> {
  const day = 86_400_000;
  const since = new Date(now.getTime() - 2 * GROWTH_DAYS * day).toISOString();
  const mid = new Date(now.getTime() - GROWTH_DAYS * day).toISOString();
  const { refundsSince } = await import("@/core/orders/refund");
  const [rows, refunds, cur, prev] = await Promise.all([
    pageAll<GrowthOrder>(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("id, created_at, total, paid_amount, currency, status, fulfillment_kind")
          .in("status", ["delivered", "accepted", "in_production", "ready"])
          .gte("created_at", since)
          .lte("created_at", now.toISOString())
          .order("id", { ascending: true })
          .range(from, to),
      "Рост: заказы",
    ),
    refundsSince(ctx, since),
    ctx.db
      .from("bot_users")
      .select("user_key", { count: "exact", head: true })
      .gte("created_at", mid)
      .lte("created_at", now.toISOString()),
    ctx.db
      .from("bot_users")
      .select("user_key", { count: "exact", head: true })
      .gte("created_at", since)
      .lt("created_at", mid),
  ]);
  if (cur.error) throw serverFailure(`Рост: покупатели: ${cur.error.message}`);
  if (prev.error) throw serverFailure(`Рост: покупатели: ${prev.error.message}`);
  return { ...growthOrders(rows, refunds, now), buyers: trio(cur.count ?? 0, prev.count ?? 0) };
}
