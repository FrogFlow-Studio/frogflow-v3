import type { TenantContext } from "@/core/tenant/resolve.server";
import { rejectOrder } from "@/core/orders/orders";

/**
 * Неоплаченный заказ с сайта живёт сутки: без чека и оплаты он отменяется
 * общей отменой rejectOrder (статус cancelled), а списанный остаток
 * возвращается на склад. Оформить заказ на сайте может кто угодно, поэтому
 * брошенные заказы не должны держать товар. Ночная
 * уборка v1 (nightly_orders_maintenance) удаляет такие заказы только через
 * неделю и остаток не возвращает.
 */
export const WEB_ORDER_TTL_MS = 24 * 3600_000;

export async function expireWebOrders(
  ctx: TenantContext,
  now = new Date(),
): Promise<{ cancelled: number }> {
  const cutoff = new Date(now.getTime() - WEB_ORDER_TTL_MS).toISOString();
  const { data } = await ctx.db
    .from("orders")
    .select("id")
    .eq("platform", "web")
    .eq("status", "awaiting_payment")
    .is("payment_proof_path", null)
    .lt("created_at", cutoff)
    .limit(200);
  let cancelled = 0;
  for (const o of data ?? []) {
    // Та же отмена, что у продавца (возврат остатка и баллов), но только из
    // «ждёт оплаты»: чек или оплата картой в ту же минуту выигрывают.
    if (
      await rejectOrder(ctx, o.id, "cron", {
        from: ["awaiting_payment"],
        to: "cancelled",
      })
    )
      cancelled++;
  }
  return { cancelled };
}
