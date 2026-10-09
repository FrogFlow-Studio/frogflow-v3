import type { TenantContext } from "@/core/tenant/resolve.server";
import { recordOrderEvent } from "./events";
import type { Customer } from "@/core/customers/customers";
import { setState } from "@/core/customers/customers";
import { listCart, clearCart, priceCart, type CartItem } from "@/core/cart/cart";
import {
  materialLanguages,
  materialsForProduct,
  type MaterialSnapshot,
  isDeliveryLangChoice,
  type DeliveryLangChoice,
} from "@/core/catalog/materials";
import { applyDiscounts, normalizeCode } from "@/core/discounts/pure";
import { belowMinimum } from "@/core/cart/min-order";
import { OFFER_ROW_MARK } from "@/core/offers/offers";
import { releaseOfferHolds } from "@/core/offers/holds";
import { amountDueNow, decrementStock, restoreStock } from "@/core/fulfillment/fulfillment";
import { recordStockChanges, type StockChange } from "@/core/catalog/stock-history";
import { bundleOf, decrementBundle, newStockTake, recordBundleChanges } from "@/core/bundles/stock";
import {
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
  rollbackRedemptions,
  toOrderCurrency,
  type Redemptions,
} from "@/core/discounts/discounts";
import { serverFailure } from "@/lib/server-failure";
import { toJson } from "@/core/json";
import { type OrderWithItems, type PaymentMethodRow, paymentMethodFor } from "./order-model";

/** Оформление заказа из корзины. */

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
  if (error) throw serverFailure(`claim_order_placement: ${error.message}`);
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
      /** Заказ отмечен подарком (модуль bundles): что записано; текст мог быть обрезан (`truncated`). */
      gift: import("./gift").OrderGift | null;
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
        /** Упаковку выбрали, а её уже нет или цену не перевести: заказ не создан, упаковку надо снять. */
        | "gift_wrap_unavailable"
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
  /** «Это подарок» (модуль bundles): получатель и открытка; пишется событием заказа `gift`. */
  gift?: { recipient?: string | null; message?: string | null } | null;
  /** Подарочная упаковка к подарку (core/orders/gift-wrap); без `gift` игнорируется. */
  giftWrap?: boolean;
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
  const take = newStockTake();
  const reserved = take.reserved;
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
        // Набор: списываются составляющие, у самого набора остатка нет.
        const parts = await bundleOf(ctx, it.products!.id);
        if (parts) {
          if (!(await decrementBundle(ctx, it.products!.id, parts, qty, take))) {
            await ctx.db.from("cart_items").delete().eq("id", it.id);
            return await fail("out_of_stock");
          }
          continue;
        }
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
    // Подарочная упаковка — после скидок: промокод её не скидывает (как и доставку по правилу
    // продавца), сумма — та же функция, что в подсказках каналов.
    let wrapFee = 0;
    if (opts.giftWrap && opts.gift && m.bundles && priced.kind === "physical") {
      const { giftWrapFee } = await import("./gift-wrap");
      const fee = await giftWrapFee(ctx, priced.currency);
      if (!fee || fee <= 0) return await fail("gift_wrap_unavailable");
      wrapFee = fee;
      total += wrapFee;
    }

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
      await dropUnplacedOrder(ctx, order.id);
      return await fail("order_failed");
    }
    // Подарочная упаковка — отдельная позиция без товара: её сумма уже в итоге заказа.
    if (wrapFee > 0) {
      const { giftWrapName } = await import("./gift-wrap");
      const { error: wrapError } = await ctx.db.from("order_items").insert({
        bot_id: ctx.tenant.id,
        order_id: order.id,
        product_id: null,
        product_variant_id: null,
        name_snapshot: giftWrapName(customer.state.locale),
        price_snapshot: wrapFee,
        quantity: 1,
      });
      if (wrapError) {
        await ctx.db.from("order_items").delete().eq("order_id", order.id);
        await dropUnplacedOrder(ctx, order.id);
        return await fail("order_failed");
      }
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
    // Подарок — до остального: уведомление продавцу читает его при отправке.
    let orderGift: import("./gift").OrderGift | null = null;
    if (opts.gift && ctx.tenant.modules.bundles) {
      const { normalizeGift, recordOrderGift } = await import("./gift");
      orderGift = normalizeGift(opts.gift);
      if (!(await recordOrderGift(ctx, finalOrder.id, orderGift, wrapFee))) orderGift = null;
    }
    await recordStockChanges(ctx, stockChanges, {
      reason: "order",
      orderId: finalOrder.id,
      actor: "customer",
    });
    await recordBundleChanges(ctx, take, { orderId: finalOrder.id, actor: "customer" });
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
      gift: orderGift,
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
    material_files_snapshot: toJson(byLang.ru ?? []),
    material_files_kz_snapshot: toJson(byLang.kk ?? []),
    material_files_by_lang: toJson(byLang),
  };
}
