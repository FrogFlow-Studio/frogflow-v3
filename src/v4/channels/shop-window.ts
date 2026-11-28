import type { V4Db } from "../core/db";
import { claimInbound } from "../core/depth";
import { touchBuyer } from "../core/platform";
import { createOffer, peekOffer, pressBuy } from "../seller/offers";

/**
 * Покупка из Mini App. Покупатель тот же, что в чате Telegram: канал telegram
 * и тот же внешний id. Код предложения — заказ по цене, которую уже показали.
 * Без кода окно само держит цену на 72 часа и создаёт один заказ на ключ нажатия.
 */

export type ShopBuy =
  { ok: true; orderId: string; no: number; reused: boolean } | { ok: false; code: string };

function sameBag(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const key = (xs: string[]) => [...xs].sort().join("\0");
  return key(a) === key(b);
}

async function release(db: V4Db, botId: string, claimId: string): Promise<void> {
  await db.call("release_inbound", {
    p_bot_id: botId,
    p_channel: "telegram",
    p_external_id: claimId,
  });
}

export async function buyInShop(
  db: V4Db,
  input: {
    botId: string;
    telegramId: string;
    country: string | null;
    productIds: string[];
    claimId: string;
    offerId?: string;
    now?: Date;
  },
): Promise<ShopBuy> {
  const ids = input.productIds.filter(Boolean);
  if (ids.length === 0) return { ok: false, code: "empty_order" };
  if (ids.length > 10) return { ok: false, code: "too_many" };
  const claimed = await claimInbound(db, {
    botId: input.botId,
    channel: "telegram",
    externalId: input.claimId,
  });
  if (!claimed) return { ok: false, code: "duplicate" };
  const now = input.now ? { now: input.now } : {};
  try {
    const buyerId = await touchBuyer(db, {
      botId: input.botId,
      channel: "telegram",
      externalId: input.telegramId,
      country: input.country,
      ...now,
    });
    let offerId = input.offerId?.toUpperCase();
    if (offerId) {
      const seen = await peekOffer(db, { botId: input.botId, buyerId, offerId, ...now });
      if (!seen.ok || !sameBag(seen.productIds, ids)) {
        await release(db, input.botId, input.claimId);
        return { ok: false, code: seen.ok ? "not_found" : seen.reason };
      }
    } else {
      const fresh = await createOffer(db, {
        botId: input.botId,
        buyerId,
        productIds: ids,
        mode: "live",
        ...now,
      });
      if (!fresh.ok) {
        await release(db, input.botId, input.claimId);
        return { ok: false, code: fresh.reason };
      }
      offerId = fresh.offer.offerId;
    }
    const pressed = await pressBuy(db, { botId: input.botId, buyerId, offerId, ...now });
    if (pressed.kind === "order") {
      return { ok: true, orderId: pressed.orderId, no: pressed.orderNo, reused: pressed.reused };
    }
    await release(db, input.botId, input.claimId);
    if (pressed.kind === "new_offer") return { ok: false, code: pressed.was };
    return { ok: false, code: pressed.reason };
  } catch (e) {
    await release(db, input.botId, input.claimId);
    throw e;
  }
}
