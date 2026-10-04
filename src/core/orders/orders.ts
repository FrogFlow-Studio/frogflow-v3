import { validateProofFile } from "./proof-file";
import { proofHashes } from "./proof-hash";
import { UserError } from "@/core/i18n/user-error";
import { rewardReferrerIfFirstDelivery, type ReferralGrant } from "@/core/referrals/referrals";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { protectMaterials } from "@/core/delivery/watermark.server";
import { recordOrderEvent } from "./events";
import type { Database, Json } from "@/core/db-types";
import { serviceDb } from "@/core/db/client.server";
import { isSafeStorageKey, isTenantStorageKey } from "@/core/storage/keys";
import type { Customer } from "@/core/customers/customers";
import { setState } from "@/core/customers/customers";
import { listCart, clearCart, priceCart, type CartItem } from "@/core/cart/cart";
import {
  materialLanguages,
  materialsForProduct,
  type MaterialSnapshot,
  addDeliveredLanguage,
  isDeliveryLangChoice,
  parseDeliveredLanguages,
  type DeliveryLangChoice,
} from "@/core/catalog/materials";
import { localeNames, type Locale } from "@/core/i18n/locale";
import {
  canResendMaterials,
  itemAvailableLanguages,
  itemMaterials,
  itemNeedsLanguageChoice,
  orderChannel,
  withDownloadName,
} from "./pure";
import { applyDiscounts, normalizeCode } from "@/core/discounts/pure";
import { belowMinimum } from "@/core/cart/min-order";
import { OFFER_ROW_MARK } from "@/core/offers/offers";
import { releaseOfferHolds } from "@/core/offers/holds";
import {
  amountDueNow,
  decrementStock,
  restoreOrderStock,
  restoreStock,
} from "@/core/fulfillment/fulfillment";
import { recordStockChanges, type StockChange } from "@/core/catalog/stock-history";
import {
  awardPointsForOrder,
  findValidGift,
  findValidPromoCode,
  loyaltyBalance,
  loyaltyMaxRedeemPercent,
  pointsForDiscount,
  shopCurrency,
  pointsInOrderCurrency,
  promoInOrderCurrency,
  redeemGift,
  redeemPoints,
  redeemPromoCode,
  restorePoints,
  returnOrderCodes,
  rollbackRedemptions,
  toOrderCurrency,
  type Redemptions,
} from "@/core/discounts/discounts";

export {
  canResendMaterials,
  displayNo,
  itemLanguages,
  itemMaterials,
  materialDownloadName,
} from "./pure";
import { serverFailure } from "@/lib/server-failure";
export { parseDeliveredLanguages } from "@/core/catalog/materials";

export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
export type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];
export type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };
export type PaymentMethodRow = Database["public"]["Tables"]["payment_methods"]["Row"];

export const DELIVERABLE_STATUSES = ["awaiting_payment", "awaiting_confirmation", "paid"] as const;
/** Чек принимается, только пока заказ ждёт оплаты. */
export const PROOF_STATUSES = ["awaiting_payment", "awaiting_confirmation"] as const;
export const REJECTABLE_STATUSES = [
  ...DELIVERABLE_STATUSES,
  "accepted",
  "in_production",
  "ready",
] as const;

export async function listActivePaymentMethods(ctx: TenantContext): Promise<PaymentMethodRow[]> {
  const { data, error } = await ctx.db
    .from("payment_methods")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw serverFailure(`Способы оплаты не прочитаны: ${error.message}`);
  return data ?? [];
}

export async function paymentMethodFor(
  ctx: TenantContext,
  countryCode: string,
): Promise<PaymentMethodRow | null> {
  const { data, error } = await ctx.db
    .from("payment_methods")
    .select("*")
    .eq("country_code", countryCode)
    .eq("is_active", true)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`Способ оплаты для ${countryCode} не прочитан: ${error.message}`);
  return data ?? null;
}

/**
 * Атомарный захват оформления: RPC claim_order_placement (MIGRATION-27)
 * ставит bot_users.state.placing_order одним оператором. Двойной тап по
 * «Оформить» не создаёт второго заказа. CAS по updated_at здесь не годится —
 * его двигает триггер на любой апдейт строки.
 */
export async function claimOrderPlacement(
  ctx: TenantContext,
  customer: Customer,
): Promise<boolean> {
  const { data, error } = await ctx.db.rpc("claim_order_placement", {
    p_bot_id: ctx.tenant.id,
    p_telegram_id: customer.telegramId,
  });
  if (error) throw new Error(`claim_order_placement: ${error.message}`);
  return data === true;
}

export async function releaseOrderPlacement(
  ctx: TenantContext,
  customer: Customer,
  state = customer.state,
): Promise<void> {
  const { placing_order: _p, ...rest } = state;
  await setState(ctx, customer, rest);
}

export type PlaceOrderResult =
  | {
      ok: true;
      order: OrderWithItems;
      method: PaymentMethodRow;
      priced: Awaited<ReturnType<typeof priceCart>>;
      /** Скидки покрыли всё: чек не нужен, заказ можно выдавать сразу. */
      zeroTotal: boolean;
      /** Сколько платить сейчас: задаток или ноль при оплате при получении. */
      amountDue: number;
      /** Сертификат больше заказа — код на остаток (покупателю в подтверждении). */
      giftRest: import("@/core/discounts/gift-rest").GiftRest | null;
    }
  | {
      ok: false;
      reason:
        | "busy"
        | "empty_cart"
        | "country_unavailable"
        | "order_failed"
        | "promo_invalid"
        /** Код «один раз на покупателя», а покупатель его уже брал. */
        | "promo_used"
        | "gift_invalid"
        /** Скидку не перевести в валюту заказа: курса нет. */
        | "discount_fx"
        /** В корзине товары в разных валютах: сумму не сложить. */
        | "mixed_currency"
        | "out_of_stock"
        /** Лимит заказов на день или слот (core/fulfillment/capacity): место только что заняли. */
        | "day_full"
        | "slot_taken";
    }
  | {
      ok: false;
      /** Корзина меньше минимальной суммы заказа магазина (core/cart/min-order). */
      reason: "below_min";
      min: number;
      shortfall: number;
      currency: string;
    };

export type FulfillmentInput = {
  type: "pickup" | "delivery" | null;
  at: string | null;
  address: string | null;
  note: string | null;
  zone: { id: string; name: string; fee: number } | null;
};

export type PlaceOrderOptions = {
  promoCode?: string | null;
  usePoints?: boolean;
  giftCode?: string | null;
  fulfillment?: FulfillmentInput | null;
  /** Язык материалов, выбранный до оформления (multi_language, delivery_lang_timing = before). */
  deliveryLang?: DeliveryLangChoice | null;
  /** Счёт, выставленный продавцом сам: минимальная сумма заказа его не касается. */
  skipMinOrder?: boolean;
};

/** Скидки корзины для показа — без списания. */
export type CartSummary = {
  subtotal: number;
  currency: string;
  promo: { code: string; discount: number } | null;
  promoInvalid: boolean;
  /**
   * `spent` — сколько баллов уйдёт за скидку; `fx` — заказ не в валюте
   * магазина, покупателю показываем пересчёт («500 баллов = 100 ₽»).
   */
  points: { balance: number; discount: number; used: boolean; spent: number; fx: boolean };
  gift: { code: string; discount: number } | null;
  giftInvalid: boolean;
  /** Скидку не перевести в валюту заказа — курса нет (продавцу и покупателю — «позже»). */
  discountFx: boolean;
  total: number;
};

export async function cartSummary(
  ctx: TenantContext,
  customer: Customer,
  priced: { total: number; currency: string },
  opts: PlaceOrderOptions,
): Promise<CartSummary> {
  const m = ctx.tenant.modules;
  const promoCode = m.coupons && opts.promoCode ? normalizeCode(opts.promoCode) : null;
  const promo = promoCode ? await findValidPromoCode(ctx, promoCode, customer) : null;
  const giftCode = m.gift_certificates && opts.giftCode ? normalizeCode(opts.giftCode) : null;
  const gift = giftCode ? await findValidGift(ctx, giftCode) : null;
  const balance = m.loyalty ? await loyaltyBalance(ctx, customer.telegramId) : 0;
  const usePoints = Boolean(m.loyalty && opts.usePoints && balance > 0);
  const pointsMaxPercent = usePoints ? await loyaltyMaxRedeemPercent(ctx) : 100;
  // Скидки — в валюте заказа (priced.currency): фиксированный промокод и
  // баллы из валюты магазина, сертификат из своей. Нет курса — скидки нет.
  const promoRule = promo?.ok
    ? await promoInOrderCurrency(ctx, promo.promo, priced.currency)
    : null;
  const pointsWorth = usePoints ? await pointsInOrderCurrency(ctx, balance, priced.currency) : 0;
  const giftAmount = gift?.ok
    ? await toOrderCurrency(gift.certificate.amount, gift.certificate.currency, priced.currency)
    : null;
  const r = applyDiscounts(priced.total, {
    promo: promoRule,
    points: pointsWorth ?? 0,
    pointsMaxPercent,
    gift: giftAmount,
  });
  const pointsFx =
    r.points > 0 && (await shopCurrency(ctx)) !== (priced.currency || "").toUpperCase();
  const spent =
    r.points > 0 ? ((await pointsForDiscount(ctx, r.points, balance, priced.currency)) ?? 0) : 0;
  return {
    subtotal: priced.total,
    currency: priced.currency,
    promo: promoCode && promoRule ? { code: promoCode, discount: r.promo } : null,
    promoInvalid: Boolean(promoCode && !promoRule),
    points: { balance, discount: r.points, used: usePoints, spent, fx: pointsFx },
    gift: giftCode && giftAmount != null ? { code: giftCode, discount: r.gift } : null,
    giftInvalid: Boolean(giftCode && giftAmount == null),
    discountFx: Boolean(
      (promo?.ok && !promoRule) || (gift?.ok && giftAmount == null) || pointsWorth == null,
    ),
    total: r.total,
  };
}

/**
 * Создать заказ из корзины: снимок цен и файлов в order_items, номер через
 * триггер из order_counters, корзина очищается только после успешной
 * вставки позиций (иначе покупатель платит за заказ без состава).
 *
 * Не здесь: промокоды, баллы, сертификаты, складское списание, физическая
 * доставка, «все языки» — это следующие фазы переноса (docs/ROADMAP.md),
 * каждая под своим модулем.
 */
export async function placeOrder(
  ctx: TenantContext,
  customer: Customer,
  countryCode: string,
  opts: PlaceOrderOptions = {},
): Promise<PlaceOrderResult> {
  if (!(await claimOrderPlacement(ctx, customer))) return { ok: false, reason: "busy" };
  const redemptions: Redemptions = {};
  const holdToken = crypto.randomUUID();
  let offerHeld = false;
  const reserved: Array<{ productId: string; qty: number }> = [];
  // Что фактически списано — в историю остатка, когда заказ создан (не раньше).
  const stockChanges: StockChange[] = [];
  // Заказ, под который событие истории остатка уже записано: откат ниже должен
  // тоже оставить след («−N» без «+N» в истории — расхождение с реальным остатком).
  let stockLoggedFor: number | null = null;
  const preorderLines: import("@/core/preorder/preorder").PreorderLine[] = [];
  const fail = async (
    reason: Exclude<Extract<PlaceOrderResult, { ok: false }>["reason"], "below_min">,
  ) => {
    // Каждый шаг отката не мешает остальным; освобождение покупателя — всегда.
    try {
      for (const r of reserved) await restoreStock(ctx, r.productId, r.qty);
    } catch (e) {
      console.error(`[orders] возврат остатка при откате: ${String(e)}`);
    }
    try {
      await rollbackRedemptions(ctx, customer, redemptions);
    } catch (e) {
      console.error(`[orders] откат скидок и баллов: ${String(e)}`);
    }
    await releaseOrderPlacement(ctx, customer);
    return { ok: false as const, reason };
  };
  try {
    const method = await paymentMethodFor(ctx, countryCode);
    if (!method) {
      const { country_code: _c, country_name: _n, ...rest } = customer.state;
      await releaseOrderPlacement(ctx, customer, rest);
      return { ok: false, reason: "country_unavailable" };
    }
    const items = (await listCart(ctx, customer)).filter((it) => it.products);
    if (items.length === 0) {
      await releaseOrderPlacement(ctx, customer);
      return { ok: false, reason: "empty_cart" };
    }
    const deliveryLang =
      ctx.tenant.modules.multi_language && isDeliveryLangChoice(opts.deliveryLang)
        ? opts.deliveryLang
        : null;
    const priced = await priceCart(ctx, items, countryCode, {
      deliveryLang,
      freshOffers: true,
      holdToken,
    });
    offerHeld = Boolean(priced.offerHeld);
    if (priced.mixedCurrency) return await fail("mixed_currency");
    // Минимум — до списания остатка и скидок: отказ ничего не трогает.
    if (!opts.skipMinOrder) {
      const below = await belowMinimum(ctx, priced);
      if (below) {
        await releaseOrderPlacement(ctx, customer);
        return { ok: false, reason: "below_min", ...below };
      }
    }

    // Складской учёт — до создания заказа: не хватило, откатываем уже
    // списанное и убираем раскупленную строку из корзины.
    if (ctx.tenant.modules.stock) {
      const { preordersFor } = await import("@/core/preorder/preorder");
      const flags = await preordersFor(
        ctx,
        items.map((it) => it.products!.id),
      );
      for (const it of items) {
        const qty = Number(it.quantity);
        const ok = await decrementStock(ctx, it.products!.id, qty, stockChanges);
        if (!ok) {
          // Не хватило остатка: у товара включён предзаказ — позиция идёт
          // предзаказом, остаток не трогаем (он не уходит в минус).
          const pre = flags.get(it.products!.id);
          if (pre) {
            preorderLines.push({ product_id: it.products!.id, quantity: qty, from: pre.from });
            continue;
          }
          await ctx.db.from("cart_items").delete().eq("id", it.id);
          return await fail("out_of_stock");
        }
        reserved.push({ productId: it.products!.id, qty });
      }
    }
    const f = priced.kind === "physical" ? (opts.fulfillment ?? null) : null;
    let deliveryFee = f?.type === "delivery" && f.zone ? f.zone.fee : 0;
    // Бесплатная доставка от суммы: товары после скидок ≥ порога зоны (или общего) — доставка 0.
    if (deliveryFee > 0 && f?.zone) {
      const free = await import("@/core/fulfillment/free-delivery");
      const rules = await free.loadFreeDeliveryRules(ctx);
      if (free.thresholdFor(rules, f.zone.id) > 0) {
        const sum = await cartSummary(ctx, customer, priced, opts);
        const st = await free.freeDeliveryStatus(ctx, rules, f.zone.id, {
          amount: free.goodsAfterDiscounts(sum),
          currency: priced.currency,
        });
        if (st?.free) deliveryFee = 0;
      }
    }
    // Слот получения — начало во времени fulfillment_at (core/fulfillment/slots).
    const { fulfillmentAtValue, fulfillmentSlots } = await import("@/core/fulfillment/slots");
    const fulfillmentAt = f?.at ? fulfillmentAtValue(f.at, await fulfillmentSlots(ctx)) : null;

    // Скидки в порядке v1: промокод → баллы → сертификат. Каждая списывается
    // атомарно; сорвалось ниже — всё возвращается через rollbackRedemptions.
    const m = ctx.tenant.modules;
    // Комиссия зоны до скидок: скидка действует и на доставку.
    let total = priced.total + deliveryFee;
    let promoCode: string | null = null;
    let discountAmount = 0;
    if (m.coupons && opts.promoCode) {
      const r = await redeemPromoCode(ctx, opts.promoCode, total, priced.currency, customer);
      if (!r.ok)
        return await fail(
          r.reason === "fx" ? "discount_fx" : r.reason === "used" ? "promo_used" : "promo_invalid",
        );
      promoCode = normalizeCode(opts.promoCode);
      discountAmount = r.discount;
      redemptions.promo = { id: r.promoId, previousUsedCount: r.previousUsedCount };
      total -= discountAmount;
    }
    let pointsUsed = 0;
    if (m.loyalty && opts.usePoints) {
      // Баллы — в валюте магазина, скидка — в валюте заказа (по курсу).
      const r = await redeemPoints(ctx, customer.telegramId, total, priced.currency);
      if (!r) return await fail("discount_fx");
      pointsUsed = r.points;
      redemptions.pointsUsed = pointsUsed;
      total -= r.discount;
    }
    let giftCode: string | null = null;
    let giftDiscount = 0;
    let giftSource: { code: string; currency: string; rest: number } | null = null;
    if (m.gift_certificates && opts.giftCode) {
      const r = await redeemGift(ctx, opts.giftCode, total, customer.telegramId, priced.currency);
      if (!r.ok) return await fail(r.reason === "fx" ? "discount_fx" : "gift_invalid");
      giftCode = normalizeCode(opts.giftCode);
      giftDiscount = r.discount;
      giftSource = { code: r.certificate.code, currency: r.certificate.currency, rest: r.rest };
      redemptions.giftId = r.certificateId;
      total -= giftDiscount;
    }
    total = Math.max(0, total);

    const display =
      [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
      (customer.username ? `@${customer.username}` : `id${customer.telegramId}`);

    const { data: order, error } = await ctx.db
      .from("orders")
      .insert({
        bot_id: ctx.tenant.id,
        telegram_id: customer.telegramId,
        user_key: customer.userKey,
        platform: customer.platform,
        username: customer.username,
        display_name: display,
        contact: customer.contactPhone,
        // Instagram/WhatsApp: почта для копии материалов письмом (emailOrderMaterials).
        customer_email: customer.platform !== "telegram" ? customer.email?.trim() || null : null,
        country_code: method.country_code,
        country_name: method.country_name,
        total,
        currency: priced.currency,
        status: "awaiting_payment",
        fulfillment_kind: priced.kind,
        promo_code: promoCode,
        discount_amount: discountAmount,
        points_used: pointsUsed,
        gift_certificate_code: giftCode,
        gift_certificate_discount: giftDiscount,
        fulfillment_type: f?.type ?? null,
        fulfillment_at: fulfillmentAt,
        fulfillment_address: f?.type === "delivery" ? f.address : null,
        fulfillment_note: f?.note ?? null,
        delivery_zone_id: f?.type === "delivery" ? (f.zone?.id ?? null) : null,
        delivery_zone_name: f?.type === "delivery" ? (f.zone?.name ?? null) : null,
        delivery_fee: deliveryFee,
        delivery_lang_choice: priced.kind === "physical" ? null : deliveryLang,
      })
      .select("*")
      .single();
    if (error || !order) return await fail("order_failed");
    redemptions.orderId = order.id;
    // Лимит на день и слот: заказ уже создан, поэтому его место в очереди известно
    // (core/fulfillment/capacity); лишний снимается, покупателю — честный отказ.
    if (fulfillmentAt) {
      const { fulfillmentLimits, orderOverLimit } = await import("@/core/fulfillment/capacity");
      let over: "day" | "slot" | null = null;
      try {
        over = await orderOverLimit(ctx, order, await fulfillmentLimits(ctx));
      } catch (e) {
        // Не смогли проверить — заказ не оставляем (иначе лимит обходится сбоем чтения).
        await dropUnplacedOrder(ctx, order.id).catch(() => {});
        throw e;
      }
      if (over) {
        await dropUnplacedOrder(ctx, order.id);
        return await fail(over === "day" ? "day_full" : "slot_taken");
      }
    }
    if (redemptions.giftId) {
      const link = await ctx.db
        .from("gift_certificates")
        .update({ redeemed_order_id: order.id })
        .eq("id", redemptions.giftId);
      // Без привязки к заказу сертификат не вернуть при отмене: заказ удаляется,
      // скидки откатываются (как при сбое позиций ниже).
      if (link.error) {
        console.error(`[orders] привязка сертификата к заказу #${order.id}: ${link.error.message}`);
        await ctx.db.from("orders").delete().eq("id", order.id);
        return await fail("order_failed");
      }
    }

    // Акция с лимитом: штуки по акции и остальные по полной — двумя позициями; метка акции
    // на первой, по ней считается проданное по лимиту (soldForOffer).
    const rows = priced.lines.flatMap(({ item, unit, name, offerSplit }) => {
      if (!offerSplit) return [orderItemSnapshot(ctx, order.id, item, unit.amount, name)];
      const out = [];
      if (offerSplit.offerQty > 0)
        out.push(
          orderItemSnapshot(
            ctx,
            order.id,
            item,
            unit.amount,
            `${name} ${OFFER_ROW_MARK}`,
            offerSplit.offerQty,
          ),
        );
      if (offerSplit.restQty > 0)
        out.push(
          orderItemSnapshot(ctx, order.id, item, offerSplit.restUnit, name, offerSplit.restQty),
        );
      return out;
    });
    const { error: itemsError } = await ctx.db.from("order_items").insert(rows);
    if (itemsError) {
      await ctx.db.from("orders").delete().eq("id", order.id);
      return await fail("order_failed");
    }
    // Какие позиции взяты предзаказом, помнит только это событие: по нему склад при
    // возврате не пополняют. Не записалось — заказа не будет, иначе возврат положил бы
    // на склад штуки, которые не списывались (claimOrderEvent: false = запись не легла).
    if (preorderLines.length) {
      const { claimOrderEvent } = await import("./events");
      const saved = await claimOrderEvent(ctx, order.id, "preorder", "lines", {
        lines: preorderLines,
      });
      if (!saved) {
        await ctx.db.from("order_items").delete().eq("order_id", order.id);
        await ctx.db.from("orders").delete().eq("id", order.id);
        return await fail("order_failed");
      }
    }
    // Заказ уже создан: сбой очистки корзины не должен откатывать его.
    await clearCart(ctx, customer).catch((e) =>
      console.error(`[orders] корзина после заказа #${order.id} не очищена: ${String(e)}`),
    );
    // Захват снимается здесь, а не в канале: иначе следующая кнопка
    // «Оформить» молча упирается в placing_order (поймано интеграционным
    // тестом на живой базе).
    await releaseOrderPlacement(ctx, customer);
    const { data: full, error: fullError } = await ctx.db
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", order.id)
      .single();
    // Заказ уже создан: сбой перечитывания его не срывает, берём то, что есть.
    if (fullError) console.error(`[orders] заказ #${order.id} не перечитан: ${fullError.message}`);
    const finalOrder = (full ?? { ...order, order_items: [] }) as OrderWithItems;
    await recordOrderEvent(ctx, finalOrder.id, "placed", {
      platform: finalOrder.platform,
      total: Number(finalOrder.total),
      currency: finalOrder.currency,
    });
    await recordStockChanges(ctx, stockChanges, {
      reason: "order",
      orderId: finalOrder.id,
      actor: "customer",
    });
    stockLoggedFor = finalOrder.id;
    // Сертификат больше заказа — остаток новым кодом в той же валюте. Сбой
    // выдачи заказ не срывает: сертификат погашен, остаток выдаст продавец.
    let giftRest: import("@/core/discounts/gift-rest").GiftRest | null = null;
    if (giftSource && giftSource.rest > 0.01) {
      const { issueGiftRest } = await import("@/core/discounts/gift-rest");
      giftRest = await issueGiftRest(ctx, {
        orderId: finalOrder.id,
        orderNo: finalOrder.display_no ?? finalOrder.order_no,
        sourceCode: giftSource.code,
        rest: giftSource.rest,
        currency: giftSource.currency,
      }).catch((e) => {
        console.error(`[orders] остаток сертификата по заказу #${finalOrder.id}: ${String(e)}`);
        return null;
      });
      await recordOrderEvent(
        ctx,
        finalOrder.id,
        "gift_rest",
        giftRest
          ? { code: giftRest.code, amount: giftRest.amount, currency: giftRest.currency }
          : {
              failed: true,
              amount: giftSource.rest,
              currency: giftSource.currency,
            },
      );
    }
    return {
      ok: true,
      order: finalOrder,
      method,
      priced,
      zeroTotal: total <= 0,
      amountDue: total <= 0 ? 0 : await amountDueNow(ctx, { total, fulfillment_kind: priced.kind }),
      giftRest,
    };
  } catch (e) {
    const log = stockLoggedFor === null ? undefined : cancelLog(stockLoggedFor);
    for (const r of reserved) await restoreStock(ctx, r.productId, r.qty, log).catch(() => {});
    await rollbackRedemptions(ctx, customer, redemptions).catch(() => {});
    await releaseOrderPlacement(ctx, customer).catch(() => {});
    throw e;
  } finally {
    // Позиции заказа записаны (их видно в проданном) или оформление сорвалось: штуки отпускаем.
    if (offerHeld) await releaseOfferHolds(ctx, holdToken);
  }
}

/**
 * Убрать только что созданный заказ без позиций (лимит выдачи не пропустил). Не
 * удалился — отменяем условной записью, чтобы пустой заказ не висел в ожидании и
 * не держал место; не вышло и это — serverFailure, покупателю не говорим «занято».
 */
async function dropUnplacedOrder(ctx: TenantContext, orderId: number): Promise<void> {
  const del = await ctx.db.from("orders").delete().eq("id", orderId);
  if (!del.error) return;
  console.error(`[orders] заказ #${orderId} без позиций не удалён: ${del.error.message}`);
  const cancel = await ctx.db
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId)
    .eq("status", "awaiting_payment");
  if (cancel.error)
    throw serverFailure(
      `Заказ #${orderId} без позиций не удалён и не отменён: ${cancel.error.message}`,
    );
  await recordOrderEvent(
    ctx,
    orderId,
    "status",
    { from: "awaiting_payment", to: "cancelled", reason: "limit_cleanup" },
    "system",
  );
}

/** Причина для истории остатка, когда сбой после создания заказа возвращает списанное. */
const cancelLog = (orderId: number) => ({ reason: "cancel" as const, orderId, actor: "system" });

function orderItemSnapshot(
  ctx: TenantContext,
  orderId: number,
  item: CartItem,
  price: number,
  name: string,
  quantity: number = Number(item.quantity),
) {
  const p = item.products!;
  const byLang: Record<string, MaterialSnapshot[]> = {};
  for (const lang of materialLanguages(p)) byLang[lang] = materialsForProduct(p, lang);
  return {
    bot_id: ctx.tenant.id,
    order_id: orderId,
    product_id: p.id,
    product_variant_id: item.product_variant_id,
    name_snapshot: name,
    price_snapshot: price,
    quantity,
    file_path_snapshot: p.file_path ?? null,
    file_name_snapshot: p.file_name ?? null,
    file_path_kz_snapshot: p.file_path_kz ?? null,
    file_name_kz_snapshot: p.file_name_kz ?? null,
    file_url_snapshot: p.file_url ?? null,
    file_url_kz_snapshot: p.file_url_kz ?? null,
    material_files_snapshot: (byLang.ru ?? []) as unknown as Json,
    material_files_kz_snapshot: (byLang.kk ?? []) as unknown as Json,
    material_files_by_lang: byLang as unknown as Json,
  };
}

export async function getOrder(ctx: TenantContext, id: number): Promise<OrderWithItems | null> {
  const { data, error } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw serverFailure(`Заказ #${id} не прочитан: ${error.message}`);
  return (data as OrderWithItems | null) ?? null;
}

export async function listCustomerOrders(
  ctx: TenantContext,
  customer: Customer,
  limit = 20,
): Promise<OrderWithItems[]> {
  const { data, error } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .eq("telegram_id", customer.telegramId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw serverFailure(`Заказы покупателя не прочитаны: ${error.message}`);
  return (data ?? []) as OrderWithItems[];
}

/**
 * Все выданные заказы покупателя, новые первыми, — для библиотеки «Мои
 * материалы». Без ограничения по числу: в v1 выборка из последних 80 заказов
 * теряла товары, купленные только раньше. Постранично (PostgREST режет на 1000).
 */
export async function listDeliveredOrders(
  ctx: TenantContext,
  customer: Customer,
): Promise<OrderWithItems[]> {
  const { pageAll } = await import("@/core/db/page");
  return pageAll<OrderWithItems>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("*, order_items(*)")
        .eq("telegram_id", customer.telegramId)
        .eq("status", "delivered")
        .order("created_at", { ascending: false })
        .range(from, to) as unknown as PromiseLike<{
        data: OrderWithItems[] | null;
        error: { message: string } | null;
      }>,
    "выданные заказы покупателя",
  );
}

/**
 * «Повторить заказ»: те же товары снова в корзину — по одному вызову на
 * единицу количества (addToCart считает остаток и лимиты). Снятых с продажи
 * товаров не будет; возвращает число добавленных единиц.
 */
export async function reorderIntoCart(
  ctx: TenantContext,
  customer: Customer,
  order: OrderWithItems,
): Promise<number> {
  const { addToCart } = await import("@/core/cart/cart");
  const { mergeOrderItems } = await import("@/core/offers/offers");
  let added = 0;
  // Строки «по акции» и «по полной» одного товара — вместе: потолок 20 штук на товар, не на строку.
  for (const item of mergeOrderItems(order.order_items)) {
    if (!item.product_id) continue;
    for (let i = 0; i < Math.min(Number(item.quantity) || 1, 20); i++)
      if ((await addToCart(ctx, customer, item.product_id, item.product_variant_id)) === "ok")
        added++;
  }
  return added;
}

/** Открытый заказ, ждущий чек, не старше суток — запасной путь, если состояние потерялось. */
export async function recentAwaitingPaymentOrder(
  ctx: TenantContext,
  customer: Customer,
  windowMs = 24 * 3600_000,
): Promise<number | null> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await ctx.db
    .from("orders")
    .select("id")
    .eq("telegram_id", customer.telegramId)
    .eq("status", "awaiting_payment")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`Неоплаченный заказ не прочитан: ${error.message}`);
  return data?.id ?? null;
}

export type ProofFile = { bytes: Uint8Array; mime: string; ext: string };

export type AttachProofResult =
  | { ok: true; order: OrderWithItems; hash: string }
  | {
      ok: false;
      reason:
        "not_found" | "closed" | "duplicate" | "upload_failed" | "invalid_file" | "file_too_large";
    };

/**
 * Чек оплаты: в бакет payment-proofs под префиксом bot_id (изоляция
 * хранилища — префиксом пути, не RLS), хеш против повторной отправки того
 * же чека, статус awaiting_confirmation.
 */
export async function attachPaymentProof(
  ctx: TenantContext,
  orderId: number,
  file: ProofFile,
): Promise<AttachProofResult> {
  const order = await getOrder(ctx, orderId);
  if (!order) return { ok: false, reason: "not_found" };
  if (!(PROOF_STATUSES as readonly string[]).includes(order.status))
    return { ok: false, reason: "closed" };
  // Только картинка или PDF до 20 МБ; тип и расширение — по содержимому.
  const checked = validateProofFile(file);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  file = { bytes: file.bytes, mime: checked.mime, ext: checked.ext };

  // Отпечаток содержимого, а не сырых байтов; старые чеки — и по сырому (proof-hash).
  const hashes = proofHashes(file.bytes);
  const hash = hashes.stored;
  const { data: dup, error: dupError } = await ctx.db
    .from("orders")
    .select("id")
    .in("payment_proof_hash", hashes.all)
    .neq("id", orderId)
    .limit(1)
    .maybeSingle();
  // Не прочиталось — не «дубля нет»: чужой чек не должен пройти из-за сбоя.
  if (dupError)
    throw serverFailure(`Чек заказа #${orderId} не сверен с прежними: ${dupError.message}`);
  if (dup) return { ok: false, reason: "duplicate" };

  const key = `${ctx.tenant.id}/order-${orderId}/${Date.now()}.${file.ext}`;
  const body = new Blob([file.bytes as BlobPart], {
    type: file.mime || "application/octet-stream",
  });
  const up = await serviceDb()
    .storage.from("payment-proofs")
    .upload(key, body, { contentType: file.mime, upsert: true });
  if (up.error) {
    console.error("[orders] proof upload failed", up.error);
    return { ok: false, reason: "upload_failed" };
  }
  // Пока грузился файл, заказ могли забрать на выдачу (продавец или
  // автопроверка прошлого чека). Статус пишем, только если заказ всё ещё
  // ждёт оплаты: иначе «ждёт подтверждения» поверх «выдаётся» открыло бы
  // его снова, и этот чек запустил бы вторую выдачу.
  const { data: updated, error } = await ctx.db
    .from("orders")
    .update({ payment_proof_path: key, payment_proof_hash: hash, status: "awaiting_confirmation" })
    .eq("id", orderId)
    .in("status", [...PROOF_STATUSES])
    .select("*, order_items(*)")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) {
    await serviceDb().storage.from("payment-proofs").remove([key]);
    return { ok: false, reason: "closed" };
  }
  await recordOrderEvent(ctx, orderId, "proof", { path: key });
  return { ok: true, order: updated as OrderWithItems, hash };
}

/**
 * Автопроверка одобрила чек с отпечатком `hash`: заказ становится
 * «оплачен», только если у него всё ещё этот чек. Пока шла проверка,
 * покупатель мог прислать другой файл — он перезаписал отпечаток, и
 * одобренный чек больше ни к чему не привязан: его можно было бы принести
 * к следующему заказу. Тогда false, и заказ идёт продавцу. «Оплачен»
 * закрывает приём чеков (PROOF_STATUSES), так что после этой записи
 * отпечаток уже не сменится.
 */
export async function markProofVerified(
  ctx: TenantContext,
  orderId: number,
  hash: string,
  note: string,
  /**
   * Сумма, найденная в чеке. `currency` — только если чек в другой валюте, чем
   * заказ (принят по курсу): тогда в журнал идёт сумма чека в его валюте, а
   * оплаченным считается весь заказ.
   */
  receipt?: { amount: number; currency?: string },
): Promise<boolean> {
  const { data: before, error: readError } = receipt
    ? await ctx.db
        .from("orders")
        .select("total, currency, paid_amount")
        .eq("id", orderId)
        .maybeSingle()
    : { data: null, error: null };
  if (readError) throw serverFailure(`markProofVerified: заказ #${orderId}: ${readError.message}`);
  const total = Number(before?.total ?? 0);
  const foreign = Boolean(receipt?.currency);
  const paidNow = receipt
    ? foreign
      ? total
      : Math.min(total, Number(before?.paid_amount ?? 0) + receipt.amount)
    : null;
  const { data, error } = await ctx.db
    .from("orders")
    .update({
      status: "paid",
      admin_note: note.slice(0, 500),
      ...(paidNow != null ? { paid_amount: paidNow } : {}),
    })
    .eq("id", orderId)
    .eq("status", "awaiting_confirmation")
    .eq("payment_proof_hash", hash)
    .select("id");
  if (error) throw serverFailure(`markProofVerified: заказ #${orderId}: ${error.message}`);
  const ok = Boolean(data?.length);
  if (ok && receipt && before) {
    // Платёж в журнал: из него собирается выгрузка «Оплаты». Переплата — отдельным полем.
    const over = foreign
      ? 0
      : Math.round((Number(before.paid_amount ?? 0) + receipt.amount - total) * 100) / 100;
    const { recordOrderEvent } = await import("./events");
    await recordOrderEvent(
      ctx,
      orderId,
      "payment",
      {
        amount: receipt.amount,
        currency: receipt.currency ?? before.currency,
        source: "receipt",
        ...(over > 0.01 ? { overpaid: over } : {}),
      },
      "system",
    );
  }
  return ok;
}

/** Причина для продавца, когда одобренный чек сменился другим файлом. */
export const PROOF_SWAPPED_NOTE =
  "OCR: пока проверялся чек, покупатель прислал другой файл — проверьте вручную";

/**
 * Повторная выдача по кнопке покупателя: выданный цифровой заказ снова
 * «оплачен», дальше — обычный deliverOrder. false — повторять нельзя
 * (физический, не выдан, чужой статус успел смениться).
 */
export async function reopenForResend(
  ctx: TenantContext,
  order: Pick<OrderRow, "id" | "status" | "fulfillment_kind">,
): Promise<boolean> {
  if (!canResendMaterials(order)) return false;
  const { data, error } = await ctx.db
    .from("orders")
    .update({ status: "paid" })
    .eq("id", order.id)
    .eq("status", "delivered")
    .select("id");
  if (error) throw serverFailure(`reopenForResend: заказ #${order.id}: ${error.message}`);
  return Boolean(data?.length);
}

/** CAS-захват на выдачу: из awaiting_* в delivering, иначе — уже выдан или нельзя. */
export async function claimOrderForDelivery(
  ctx: TenantContext,
  orderId: number,
  actor = "bot",
): Promise<OrderWithItems | null> {
  const { data, error } = await ctx.db
    .from("orders")
    .update({ status: "delivering", delivery_index: 0, delivery_retry_count: 0 })
    .eq("id", orderId)
    .in("status", [...DELIVERABLE_STATUSES])
    .select("*, order_items(*)")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    await recordOrderEvent(ctx, orderId, "delivery_started", {}, actor);
    return data as OrderWithItems;
  }
  const { data: existing, error: existingError } = await ctx.db
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (existingError) throw serverFailure(`Заказ #${orderId} не прочитан: ${existingError.message}`);
  if (!existing) throw new UserError("err.orders.notFound", "Заказ не найден");
  if (existing.status === "delivered" || existing.status === "delivering") return null;
  throw new UserError("err.orders.cannotDeliver", "Заказ #{no} нельзя выдать (статус: {status})", {
    no: orderId,
    status: existing.status,
  });
}

export async function rejectOrder(
  ctx: TenantContext,
  orderId: number,
  actor = "bot",
  opts: {
    /** Из каких статусов можно отклонить; по умолчанию — все открытые. */
    from?: readonly string[];
    /** «cancelled» — заказ закрыт без решения продавца (истёк срок оплаты). */
    to?: "rejected" | "cancelled";
    /** Вернуть остаток на склад в любом случае (счёт ссылкой, чей признак не записался). */
    restoreStock?: boolean;
  } = {},
): Promise<boolean> {
  // Переход статуса — CAS. Сначала из «ждёт оплаты»: так известно, что
  // заказ отменён неоплаченным, и его промокод и сертификат возвращаются.
  const from: string[] = [...(opts.from ?? REJECTABLE_STATUSES)];
  // Неоплаченный — ещё и без внесённых денег: «Внести оплату» пишет
  // paid_amount, не меняя статуса, и такой заказ кодов не возвращает.
  // Условие — в самой условной записи, чтобы оплата в ту же секунду не
  // проскочила между проверкой и отменой. «Чек на проверке» неоплаченным не
  // считаем: покупатель, возможно, уже заплатил.
  const cas = async (statuses: string[], unpaid: boolean) => {
    if (statuses.length === 0) return null;
    let q = ctx.db
      .from("orders")
      .update({ status: opts.to ?? "rejected" })
      .eq("id", orderId)
      .in("status", statuses);
    if (unpaid) q = q.not("paid_amount", "gt", 0);
    return (
      await q
        .select("id, platform, telegram_id, points_used, points_earned, promo_code")
        .maybeSingle()
    ).data;
  };
  const unpaidData = from.includes("awaiting_payment")
    ? await cas(["awaiting_payment"], true)
    : null;
  const data = unpaidData ?? (await cas(from, false));
  // Брошенный неоплаченный заказ не сжигает сертификат покупателя и не
  // расходует лимит промокода; возвращает только выигравший CAS выше.
  const codesReturned = unpaidData
    ? await returnOrderCodes(ctx, orderId, unpaidData.promo_code).catch((e) => {
        console.error(`[orders] возврат кодов заказа #${orderId}: ${String(e)}`);
        return null;
      })
    : null;
  // Списанные в заказе баллы — обратно покупателю. Переход статуса выше —
  // CAS, поэтому возвращает ровно один вызов, сколько бы их ни пришло
  // (кнопка продавца, срок жизни неоплаченного заказа с сайта).
  // Заказ уже был выдан и начислил баллы (продавец отклонил после неудачной
  // повторной выдачи) — списанное не возвращаем: покупатель получил бы и
  // скидку, и начисление за ту же покупку.
  const earned = Number(data?.points_earned) || 0;
  const pointsReturned =
    data && earned <= 0 ? Math.max(0, Math.floor(Number(data.points_used) || 0)) : 0;
  if (pointsReturned > 0) await restorePoints(ctx, Number(data!.telegram_id), pointsReturned);
  if (data)
    await recordOrderEvent(
      ctx,
      orderId,
      "rejected",
      {
        ...(opts.to === "cancelled" ? { to: "cancelled" } : {}),
        ...(pointsReturned > 0 ? { pointsReturned } : {}),
        ...(codesReturned?.promo ? { promoReturned: true } : {}),
        ...(codesReturned?.gift ? { giftReturned: true } : {}),
      },
      actor,
    );
  // Заказ с сайта оформляет кто угодно — отклонённый возвращает остаток.
  // Так же счёт ссылкой из диалога: его повтор после сбоя не держит товар.
  // И любой неоплаченный заказ (в том числе из бота и Direct): остаток списан
  // при оформлении, а сам такой заказ не истекает. Оплаченный решает возврат.
  // Статус уже сменён: сбой возврата на склад не должен терять событие и баллы ниже.
  const restock = () =>
    restoreOrderStock(ctx, orderId, "cancel", actor).catch((e) =>
      console.error(`[orders] возврат на склад заказа #${orderId}: ${String(e)}`),
    );
  if (data?.platform === "web" || unpaidData || (data && opts.restoreStock)) await restock();
  else if (data) {
    const { isInvoiceLink } = await import("./invoice-link");
    if (await isInvoiceLink(ctx, orderId)) await restock();
  }
  return Boolean(data);
}

type IssuedGift = import("@/core/discounts/gift-sale").IssuedGift;

export type MaterialSender = (
  item: OrderItemRow,
  materials: MaterialSnapshot[],
) => Promise<"sent" | "failed">;

/** Спросить покупателя, на каком языке выдать позицию; true — вопрос отправлен. */
export type LanguageAsker = (item: OrderItemRow, langs: Locale[]) => Promise<boolean>;

export type DeliverOptions = {
  /** Язык интерфейса покупателя — им выдаём, если выбора нет и он доступен. */
  lang?: Locale;
  /** Канал умеет спросить язык при выдаче (Telegram — кнопками). */
  ask?: LanguageAsker;
  /** Канал не умеет спрашивать (Direct, письмо) — при нескольких языках отдать все. */
  allWhenAmbiguous?: boolean;
  /** Кто запустил выдачу — для таймлайна заказа: bot (автоматически) или admin. */
  actor?: string;
};

export type DeliverResult = {
  ok: true;
  alreadyDelivered?: boolean;
  sent: number;
  failed: number;
  /** Позиции, по которым ждём ответа покупателя о языке: заказ остаётся «выдаётся». */
  pending: number;
  /** Начислено баллов за покупку (модуль loyalty), 0 — нет. */
  pointsEarned: number;
  /** Награда пригласившему (модуль referral) — каналу осталось её отправить. */
  referral?: ReferralGrant | null;
};

/** Ссылка на уроки, если позиция — курс (модуль courses); см. core/courses/delivery. */
async function courseLink(ctx: TenantContext, item: OrderItemRow): Promise<MaterialSnapshot[]> {
  if (!ctx.tenant.modules.courses) return [];
  const { courseMaterials } = await import("@/core/courses/delivery.server");
  const links = await courseMaterials(ctx, item);
  if (links.length) {
    // Прохождение — с выдачи: ученик потока получит сообщение о старте.
    const { startRunAtDelivery } = await import("@/core/courses/run.server");
    await startRunAtDelivery(ctx, item).catch(() => {});
  }
  return links;
}

/** Отметить язык выданным; возвращает новое значение колонки — следующий язык копится поверх него. */
async function markDelivered(
  ctx: TenantContext,
  item: OrderItemRow,
  current: string | null,
  lang: Locale,
): Promise<string> {
  const next = addDeliveredLanguage(current, lang);
  const marked = await ctx.db
    .from("order_items")
    .update({ delivered_language: next })
    .eq("id", item.id);
  if (marked.error)
    console.error(`[orders] язык выдачи позиции ${item.id} не записан: ${marked.error.message}`);
  return next;
}

/** Имя позиции с языком, когда языков у выдачи больше одного. */
export function itemLabel(item: OrderItemRow, lang: Locale, many: boolean): OrderItemRow {
  return many ? { ...item, name_snapshot: `${item.name_snapshot} (${localeNames[lang]})` } : item;
}

/**
 * Ход выдачи не записался: дальше не шлём, но заказ не оставляем в «delivering»
 * (его не берёт ни повтор, ни кнопки продавца). Переводим туда, откуда продавец
 * повторит выдачу, — «ждёт подтверждения» с пометкой и событием; best effort,
 * потом бросаем сбой.
 */
async function abortDelivery(
  ctx: TenantContext,
  order: OrderWithItems,
  remaining: number,
  total: number,
  dbMessage: string,
): Promise<never> {
  try {
    const { error } = await ctx.db
      .from("orders")
      .update({ status: "awaiting_confirmation", admin_note: "Выдача прервана: сбой базы" })
      .eq("id", order.id);
    if (error)
      console.error(`[orders] заказ #${order.id} не переведён после сбоя: ${error.message}`);
    await recordOrderEvent(ctx, order.id, "delivery_failed", { failed: remaining, total });
  } catch (e) {
    console.error(`[orders] разбор сбоя выдачи заказа #${order.id}: ${String(e)}`);
  }
  throw serverFailure(`Заказы: ход выдачи: ${dbMessage}`);
}

async function finalizeDelivery(
  ctx: TenantContext,
  order: OrderWithItems,
  failed: number,
  total: number,
  /** Заказ — покупка сертификата: баллов нет (их дадут за покупку сертификатом), код — письмом. */
  sale: { gift: IssuedGift | null } | null = null,
): Promise<{ pointsEarned: number; referral: ReferralGrant | null }> {
  const closed = await ctx.db
    .from("orders")
    .update(
      failed
        ? {
            status: "awaiting_confirmation",
            admin_note: `Выдача не удалась: ${failed} из ${total}`,
          }
        : { status: "delivered" },
    )
    .eq("id", order.id);
  // «Выдан» не записан — ни событий, ни баллов, ни награды: статус не врёт.
  if (closed.error) throw serverFailure(`Заказы: статус после выдачи: ${closed.error.message}`);
  await recordOrderEvent(
    ctx,
    order.id,
    failed ? "delivery_failed" : "delivered",
    failed ? { failed, total } : { sent: total },
  );
  const pointsEarned =
    failed || sale
      ? 0
      : await awardPointsForOrder(
          ctx,
          order.id,
          order.telegram_id,
          Number(order.total),
          order.currency,
        ).catch((e) => {
          // Заказ уже выдан: сбой начисления не рвёт выдачу (отметка снята — повторится).
          console.error(`[orders] баллы за заказ #${order.id}: ${String(e)}`);
          return 0;
        });
  // Покупка сертификата — не покупка у магазина: ни баллов, ни награды пригласившему;
  // награда придёт, когда покупатель получит обычный заказ.
  const referral =
    failed || sale
      ? null
      : await rewardReferrerIfFirstDelivery(ctx, order.telegram_id).catch((e) => {
          console.error(`[orders] награда пригласившему, заказ #${order.id}: ${String(e)}`);
          return null;
        });
  // Покупателю из Instagram/WhatsApp — копия материалов на почту: ссылки в
  // переписке живут 7 дней и теряются, письмо остаётся.
  if (!failed && sale?.gift) {
    const { emailGiftCode } = await import("@/core/discounts/gift-mail");
    await emailGiftCode(ctx, order, sale.gift).catch((e) =>
      console.warn(`[orders] письмо с сертификатом по заказу #${order.id}: ${String(e)}`),
    );
  } else if (!failed && orderChannel(order.platform) !== "telegram" && order.customer_email) {
    const fresh = await getOrder(ctx, order.id);
    const { emailOrderMaterials } = await import("./email");
    await emailOrderMaterials(ctx, fresh ?? order).catch((e) =>
      console.warn(`[orders] письмо по заказу #${order.id}: ${String(e)}`),
    );
  }
  return { pointsEarned, referral };
}

/**
 * Выдача цифрового заказа. Канал приносит функцию отправки; ядро отвечает
 * за захват, порядок, статусы, delivery_index (сколько позиций уже ушло —
 * повторная выдача продолжает, а не дублирует) и языки: выбранный до
 * оформления язык или «все», уже выданные языки при повторе, вопрос
 * покупателю при выдаче (заказ остаётся «выдаётся», пока он не ответит),
 * иначе язык интерфейса или первый доступный.
 */
export async function deliverOrder(
  ctx: TenantContext,
  orderId: number,
  send: MaterialSender,
  opts: DeliverOptions = {},
): Promise<DeliverResult> {
  const order = await claimOrderForDelivery(ctx, orderId, opts.actor);
  if (!order)
    return { ok: true, alreadyDelivered: true, sent: 0, failed: 0, pending: 0, pointsEarned: 0 };
  const multi = ctx.tenant.modules.multi_language;
  const choice =
    multi && isDeliveryLangChoice(order.delivery_lang_choice) ? order.delivery_lang_choice : null;
  const items = order.order_items.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // Покупка подарочного сертификата на сайте: позиция без товара, вместо
  // файлов — код (core/discounts/gift-sale), один на заказ.
  if (order.platform === "web" && items.length > 0 && items.every((i) => !i.product_id)) {
    const { giftSaleOf, issueGiftForOrder } = await import("@/core/discounts/gift-sale");
    if (await giftSaleOf(ctx, orderId)) {
      const gift = await issueGiftForOrder(ctx, order);
      const lang = opts.lang ?? ctx.tenant.settings.default_locale ?? "ru";
      for (const item of items) {
        if (gift) {
          await markDelivered(ctx, item, item.delivered_language, lang);
          await recordOrderEvent(ctx, orderId, "item_sent", { name: item.name_snapshot });
        } else
          await recordOrderEvent(ctx, orderId, "item_failed", {
            name: item.name_snapshot,
            reason: "не удалось создать код сертификата",
          });
      }
      const indexed = await ctx.db
        .from("orders")
        .update({ delivery_index: items.length })
        .eq("id", orderId);
      if (indexed.error)
        await abortDelivery(ctx, order, items.length, items.length, indexed.error.message);
      const failedGift = gift ? 0 : items.length;
      const fin = await finalizeDelivery(ctx, order, failedGift, items.length, { gift });
      return { ok: true, sent: items.length - failedGift, failed: failedGift, pending: 0, ...fin };
    }
  }
  let sent = 0;
  let failed = 0;
  let pending = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const langs = itemAvailableLanguages(item, multi);
    const delivered = parseDeliveredLanguages(item.delivered_language);
    let result: "sent" | "failed" | "pending" = "failed";
    const sendLangs = async (list: Locale[]) => {
      let ok = true;
      let current = item.delivered_language;
      // Ссылка на курс — один раз на позицию, с первым выданным языком.
      let course = delivered.size === 0 ? await courseLink(ctx, item) : [];
      for (const l of list) {
        const materials = itemMaterials(item, l);
        if (materials.length === 0) continue;
        const payload = [...(await protectMaterials(ctx, order, materials)), ...course];
        course = [];
        // Курс без уроков или без адреса витрины: отправлять нечего — сбой
        // выдачи, продавец увидит его, а покупатель не получит пустое сообщение.
        const r = payload.length
          ? await send(itemLabel(item, l, list.length > 1), payload)
          : "failed";
        if (r === "sent") {
          current = await markDelivered(ctx, item, current, l);
          await recordOrderEvent(ctx, orderId, "item_sent", { name: item.name_snapshot, lang: l });
        } else {
          ok = false;
          await recordOrderEvent(ctx, orderId, "item_failed", {
            name: item.name_snapshot,
            lang: l,
            reason: "канал не доставил файл",
          });
        }
      }
      return ok ? ("sent" as const) : ("failed" as const);
    };
    if (langs.length === 0) result = "failed";
    else if (choice === "all") result = await sendLangs(langs);
    else if (choice) result = await sendLangs([langs.includes(choice) ? choice : langs[0]!]);
    else if (multi && delivered.size > 0)
      // Повторная выдача: те же языки, что покупатель уже выбирал, без переспроса.
      result = await sendLangs(langs.filter((l) => delivered.has(l)));
    else if (langs.length > 1 && opts.ask)
      result = (await opts.ask(item, langs)) ? "pending" : "failed";
    else if (langs.length > 1 && opts.allWhenAmbiguous) result = await sendLangs(langs);
    else {
      const l = opts.lang && langs.includes(opts.lang) ? opts.lang : langs[0]!;
      result = await sendLangs([l]);
    }
    if (result === "sent") sent++;
    else if (result === "pending") {
      pending++;
      await recordOrderEvent(ctx, orderId, "item_pending", { name: item.name_snapshot });
    } else {
      failed++;
      if (langs.length === 0)
        await recordOrderEvent(ctx, orderId, "item_failed", {
          name: item.name_snapshot,
          reason: "у товара нет файлов или ссылок",
        });
    }
    const progress = await ctx.db
      .from("orders")
      .update({ delivery_index: i + 1 })
      .eq("id", orderId);
    // Ход выдачи не записан — дальше не шлём, иначе повтор отправит позицию второй раз.
    if (progress.error)
      await abortDelivery(
        ctx,
        order,
        Math.max(1, failed + (items.length - i - 1)),
        items.length,
        progress.error.message,
      );
  }
  if (pending > 0 && failed === 0)
    return { ok: true, sent, failed, pending, pointsEarned: 0, referral: null };
  const fin = await finalizeDelivery(ctx, order, failed, items.length);
  return { ok: true, sent, failed, pending, ...fin };
}

export type LanguagePickResult =
  | { status: "not_found" | "already" | "no_materials" | "failed" }
  | {
      status: "sent";
      /** Все позиции выданы — заказ закрыт. */
      completed: boolean;
      pointsEarned: number;
      referral: ReferralGrant | null;
    };

/** Заказ, по которому покупатель может выбрать язык файла: оплачен и выдаётся. */
export const LANGUAGE_PICK_STATUSES = ["paid", "delivering", "delivered"] as const;

/**
 * Покупатель ответил на вопрос о языке позиции: выдать её на этом языке и,
 * если ни одна позиция больше не ждёт выбора, закрыть заказ.
 */
export async function completeLanguageDelivery(
  ctx: TenantContext,
  p: { orderId: number; itemId: string; lang: Locale; telegramId: number },
  send: MaterialSender,
): Promise<LanguagePickResult> {
  const order = await getOrder(ctx, p.orderId);
  if (!order || order.telegram_id !== p.telegramId) return { status: "not_found" };
  // Кнопку языка можно подделать: файлы — только по оплаченному заказу в выдаче.
  if (!(LANGUAGE_PICK_STATUSES as readonly string[]).includes(order.status))
    return { status: "not_found" };
  const item = order.order_items.find((i) => i.id === p.itemId);
  if (!item) return { status: "not_found" };
  const delivered = parseDeliveredLanguages(item.delivered_language);
  if (delivered.has(p.lang)) return { status: "already" };
  // Оплачен один язык: после первого выбора другие — только за «все языки».
  if (delivered.size > 0 && order.delivery_lang_choice !== "all") return { status: "already" };
  const materials = itemMaterials(item, p.lang);
  if (materials.length === 0) return { status: "no_materials" };
  const course = item.delivered_language ? [] : await courseLink(ctx, item);
  const payload = [...(await protectMaterials(ctx, order, materials)), ...course];
  const r = payload.length ? await send(item, payload) : "failed";
  if (r !== "sent") {
    await recordOrderEvent(ctx, p.orderId, "item_failed", {
      name: item.name_snapshot,
      lang: p.lang,
      reason: "канал не доставил файл",
    });
    return { status: "failed" };
  }
  await markDelivered(ctx, item, item.delivered_language, p.lang);
  await recordOrderEvent(ctx, p.orderId, "item_sent", { name: item.name_snapshot, lang: p.lang });
  const multi = ctx.tenant.modules.multi_language;
  const stillPending = order.order_items.some((it) =>
    itemNeedsLanguageChoice(
      it.id === item.id
        ? { ...it, delivered_language: addDeliveredLanguage(item.delivered_language, p.lang) }
        : it,
      multi,
    ),
  );
  if (stillPending || order.status !== "delivering")
    return { status: "sent", completed: false, pointsEarned: 0, referral: null };
  const fin = await finalizeDelivery(ctx, order, 0, order.order_items.length);
  return { status: "sent", completed: true, ...fin };
}

/**
 * Подписанная ссылка на файл товара. `downloadName` — имя, под которым файл
 * скачается (materialDownloadName): с ним хранилище отдаёт вложение
 * «Пазлы БУКВЫ.pdf», а не страницу с ключом «1782643012614-ni1xub.pdf».
 */
export async function signedFileUrl(
  path: string,
  ttlSec = 7 * 24 * 3600,
  downloadName?: string,
): Promise<string | null> {
  if (!isSafeStorageKey(path)) return null;
  const { data, error } = await serviceDb()
    .storage.from("product-files")
    .createSignedUrl(path, ttlSec);
  if (error || !data?.signedUrl) return null;
  return downloadName ? withDownloadName(data.signedUrl, downloadName) : data.signedUrl;
}

/** Файл из общего бакета принадлежит арендатору, только если лежит под его префиксом. */
export function isOwnStorageKey(ctx: TenantContext, key: string): boolean {
  return isTenantStorageKey(ctx.tenant.id, key);
}

/**
 * Почта покупателя в заказ (Instagram/WhatsApp, выдача письмом). Ошибку
 * базы не глотаем: иначе покупатель услышит «записал», а письмо не уйдёт.
 * Чужой или удалённый заказ — false, не ошибка.
 */
export async function setOrderEmail(
  ctx: TenantContext,
  orderId: number,
  telegramId: number,
  email: string,
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("orders")
    .update({ customer_email: email })
    .eq("id", orderId)
    .eq("telegram_id", telegramId)
    .select("id");
  if (error)
    throw serverFailure(`Не удалось сохранить почту в заказе #${orderId}: ${error.message}`);
  return (data ?? []).length > 0;
}
