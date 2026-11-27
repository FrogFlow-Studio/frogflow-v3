import { claimInbound } from "../core/depth";
import { checkout, type BuyerChannel } from "./inbound";
import type { V4Db } from "../core/db";

/**
 * Одна покупка из канала. Повтор того же claimId не создаёт второй заказ:
 * заявка входящего пишется до place_order.
 */
export async function buyFromChannel(
  db: V4Db,
  input: {
    botId: string;
    channel: BuyerChannel;
    externalId: string;
    country: string | null;
    productIds: string[];
    claimId: string;
    by: string;
    now?: Date;
  },
): Promise<
  { ok: true; buyerId: string; orderId: string; no: number } | { ok: false; code: string }
> {
  const claimed = await claimInbound(db, {
    botId: input.botId,
    channel: input.channel,
    externalId: input.claimId,
  });
  if (!claimed) return { ok: false, code: "duplicate" };
  const order = await checkout(db, {
    botId: input.botId,
    channel: input.channel,
    externalId: input.externalId,
    country: input.country,
    productIds: input.productIds,
    by: input.by,
    ...(input.now ? { now: input.now } : {}),
  });
  if (order.type === "order") {
    return { ok: true, buyerId: order.buyerId, orderId: order.order.id, no: order.order.no };
  }
  if (order.type === "refused") return { ok: false, code: order.code };
  return { ok: false, code: "order_not_found" };
}
