/**
 * Воронка покупателя за окно [from, to): три постраничных чтения по порядку
 * (правило больших магазинов, #156) и сборка в core/analytics/funnel.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage } from "@/core/db/page";
import { FunnelAcc, type FunnelRow } from "./funnel";

export async function buyerFunnel(ctx: TenantContext, from: Date, to: Date): Promise<FunnelRow[]> {
  const since = from.toISOString();
  const until = to.toISOString();
  const acc = new FunnelAcc();
  await Promise.all([
    eachPage(
      (a, b) =>
        ctx.db
          .from("bot_users")
          .select("platform, user_key")
          .gte("created_at", since)
          .lt("created_at", until)
          .order("created_at")
          .order("user_key")
          .range(a, b),
      "покупатели для воронки",
      (rows) => {
        for (const u of rows) acc.user(u);
      },
    ),
    eachPage(
      (a, b) =>
        ctx.db
          .from("cart_items")
          .select("user_key, telegram_id")
          .gte("created_at", since)
          .lt("created_at", until)
          .order("created_at")
          .order("id")
          .range(a, b),
      "корзины для воронки",
      (rows) => {
        for (const c of rows) acc.cartItem(c);
      },
    ),
    eachPage(
      (a, b) =>
        ctx.db
          .from("orders")
          .select("platform, user_key, telegram_id, status, fulfillment_kind")
          .gte("created_at", since)
          .lt("created_at", until)
          .order("created_at")
          .order("id")
          .range(a, b),
      "заказы для воронки",
      (rows) => {
        for (const o of rows) acc.order(o);
      },
    ),
  ]);
  return acc.rows();
}
