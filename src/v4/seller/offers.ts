import { serverFailure } from "@/lib/server-failure";
import type { AgentMode } from "../agent/conversation";
import type { V4Db } from "../core/db";

/**
 * Предложения бота (migrations/v4/020-offers.sql). Кнопка «Купить» ведёт на
 * предложение: товары и цены на момент показа, срок 72 часа. Нажатие создаёт
 * заказ один раз (8 нажатий — 1 заказ); цена изменилась или срок вышел —
 * покупатель видит новое предложение, а не платит другую сумму (Д1, Д3).
 */

export type OfferItem = { productId: string; title: string; amountMinor: number };
export type Offer = { offerId: string; currency: string; totalMinor: number; items: OfferItem[] };

export type OfferRefusal = "choose_variant" | "product_unavailable" | "empty_order" | "too_many";

const REFUSALS: Record<string, OfferRefusal> = {
  "v4:choose_variant": "choose_variant",
  "v4:product_unavailable": "product_unavailable",
  "v4:empty_order": "empty_order",
  "v4:bad_status": "too_many",
};

export async function createOffer(
  db: V4Db,
  a: { botId: string; buyerId: string; productIds: string[]; mode: AgentMode; now?: Date },
): Promise<{ ok: true; offer: Offer } | { ok: false; reason: OfferRefusal }> {
  let rows: Record<string, unknown>[];
  try {
    rows = await db.call("create_offer", {
      p_bot_id: a.botId,
      p_buyer_id: a.buyerId,
      p_product_ids: a.productIds,
      p_mode: a.mode,
      ...(a.now ? { p_now: a.now.toISOString() } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = Object.keys(REFUSALS).find((k) => msg.includes(k));
    if (code) return { ok: false, reason: REFUSALS[code]! };
    throw e;
  }
  const r = rows[0]?.create_offer as
    | {
        offer_id: string;
        currency: string;
        total_minor: number | string;
        items: Array<{ product_id: string; title: string; amount_minor: number | string }>;
      }
    | undefined;
  if (!r) throw serverFailure("v4.create_offer: пустой ответ");
  return {
    ok: true,
    offer: {
      offerId: r.offer_id,
      currency: r.currency,
      totalMinor: Number(r.total_minor),
      items: r.items.map((i) => ({
        productId: i.product_id,
        title: i.title,
        amountMinor: Number(i.amount_minor),
      })),
    },
  };
}

export type ClaimResult =
  | { ok: true; orderId: string; orderNo: number; reused: boolean; status: string }
  | { ok: false; reason: "not_found" | "expired" | "price_changed" | "shadow" };

export async function claimOffer(
  db: V4Db,
  a: { botId: string; buyerId: string; offerId: string; now?: Date },
): Promise<ClaimResult> {
  const r = (
    await db.call("claim_offer", {
      p_bot_id: a.botId,
      p_buyer_id: a.buyerId,
      p_offer_id: a.offerId,
      ...(a.now ? { p_now: a.now.toISOString() } : {}),
    })
  )[0]?.claim_offer as Record<string, unknown> | undefined;
  if (!r) throw serverFailure("v4.claim_offer: пустой ответ");
  if (r.ok === true)
    return {
      ok: true,
      orderId: String(r.order_id),
      orderNo: Number(r.order_no),
      reused: Boolean(r.reused),
      status: String(r.status),
    };
  return { ok: false, reason: r.reason as "not_found" | "expired" | "price_changed" | "shadow" };
}

/**
 * Нажатие «Купить» целиком: заказ; срок вышел или цена изменилась — новое
 * предложение на те же товары (покупатель видит новую цену и жмёт ещё раз);
 * товар сняли с продажи — отказ.
 */
export async function pressBuy(
  db: V4Db,
  a: { botId: string; buyerId: string; offerId: string; now?: Date },
): Promise<
  | { kind: "order"; orderId: string; orderNo: number; reused: boolean }
  | { kind: "new_offer"; offer: Offer; was: "expired" | "price_changed" }
  | { kind: "refused"; reason: "not_found" | "shadow" | OfferRefusal }
> {
  const c = await claimOffer(db, a);
  if (c.ok) return { kind: "order", orderId: c.orderId, orderNo: c.orderNo, reused: c.reused };
  if (c.reason === "not_found" || c.reason === "shadow")
    return { kind: "refused", reason: c.reason };
  const prev = (
    await db.call("offer_products", {
      p_bot_id: a.botId,
      p_buyer_id: a.buyerId,
      p_offer_id: a.offerId,
    })
  )[0]?.offer_products as { product_ids: string[]; mode: AgentMode } | null | undefined;
  if (!prev) return { kind: "refused", reason: "not_found" };
  const fresh = await createOffer(db, {
    botId: a.botId,
    buyerId: a.buyerId,
    productIds: prev.product_ids,
    mode: prev.mode,
    ...(a.now ? { now: a.now } : {}),
  });
  if (!fresh.ok) return { kind: "refused", reason: fresh.reason };
  return { kind: "new_offer", offer: fresh.offer, was: c.reason };
}

/** Привязать показанные предложения к сообщению журнала. */
export async function attachOffers(
  db: V4Db,
  a: { botId: string; offerIds: string[]; messageId: number },
): Promise<number> {
  if (!a.offerIds.length) return 0;
  const r = (
    await db.call("attach_offers", {
      p_bot_id: a.botId,
      p_offer_ids: a.offerIds,
      p_message_id: a.messageId,
    })
  )[0]?.attach_offers;
  return Number(r ?? 0);
}
