/** Скорость заказа за период: постраничное чтение таймлайна (zernio_logs) и счёт в core/analytics/speed. */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage } from "@/core/db/page";
import { ORDER_EVENT_STATUS } from "@/core/orders/events";
import { orderSpeed, SPEED_EVENT_TYPES, type SpeedEvent, type SpeedRow } from "./speed";

/**
 * Заказы, оформленные в [from, to). События оплаты и выдачи читаются до
 * `readUntil` (по умолчанию `to`): для прошлого периода это «сейчас», иначе
 * оплаты после его границы потерялись бы.
 */
export async function speedStats(
  ctx: TenantContext,
  from: Date,
  to: Date,
  readUntil: Date = to,
): Promise<SpeedRow[]> {
  const events: SpeedEvent[] = [];
  await eachPage<{
    created_at: string;
    event_type: string;
    payload: unknown;
  }>(
    (a, b) =>
      ctx.db
        .from("zernio_logs")
        .select("id, created_at, event_type, payload")
        .eq("status", ORDER_EVENT_STATUS)
        .in("event_type", SPEED_EVENT_TYPES)
        .gte("created_at", from.toISOString())
        .lt("created_at", readUntil.toISOString())
        .order("created_at")
        .order("id")
        .range(a, b),
    "события заказов для скорости",
    (rows) => {
      for (const r of rows) {
        const p =
          r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
            ? (r.payload as Record<string, unknown>)
            : {};
        const orderId = Number(p.order_id);
        if (!Number.isInteger(orderId)) continue;
        events.push({
          orderId,
          at: r.created_at,
          kind: r.event_type.slice("order.".length),
          actor: typeof p.actor === "string" ? p.actor : "bot",
          platform: typeof p.platform === "string" ? p.platform : undefined,
        });
      }
    },
  );
  return orderSpeed(events, from, to);
}
