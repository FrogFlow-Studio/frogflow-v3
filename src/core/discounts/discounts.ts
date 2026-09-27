import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { getSetting } from "@/core/settings/settings";
import { convertForReceipt, convertForTenant } from "@/core/pricing/pricing";
import {
  computePointsDiscount,
  computePointsEarned,
  computePromoDiscount,
  normalizeCode,
  type PromoDiscountType,
} from "./pure";

/* ── промокоды ────────────────────────────────────────────────────── */

export type PromoLookup =
  | {
      ok: true;
      promo: {
        id: string;
        used_count: number;
        discount_type: PromoDiscountType;
        discount_value: number;
      };
    }
  | { ok: false; reason: "not_found" | "inactive" | "expired" | "exhausted" };

export async function findValidPromoCode(ctx: TenantContext, raw: string): Promise<PromoLookup> {
  const { data: p } = await ctx.db
    .from("promo_codes")
    .select("id, used_count, discount_type, discount_value, max_uses, valid_until, is_active")
    .eq("code", normalizeCode(raw))
    .maybeSingle();
  if (!p) return { ok: false, reason: "not_found" };
  if (!p.is_active) return { ok: false, reason: "inactive" };
  if (p.valid_until && new Date(p.valid_until).getTime() < Date.now())
    return { ok: false, reason: "expired" };
  if (p.max_uses !== null && p.used_count >= p.max_uses) return { ok: false, reason: "exhausted" };
  return {
    ok: true,
    promo: {
      id: p.id,
      used_count: p.used_count,
      discount_type: p.discount_type as PromoDiscountType,
      discount_value: Number(p.discount_value),
    },
  };
}

/* ── валюта скидок ────────────────────────────────────────────────── */

/**
 * Валюта магазина (shop_currency): в ней фиксированный промокод и баллы
 * (1 балл = 1 единица валюты магазина). Сертификат — в своей currency.
 */
export async function shopCurrency(ctx: TenantContext): Promise<string> {
  return ((await getSetting(ctx, "shop_currency")) || "KZT").toUpperCase();
}

/** Сумма скидки в валюте заказа по тем же курсам, что у цен; null — курса нет. */
export async function toOrderCurrency(
  amount: number,
  from: string | null | undefined,
  orderCurrency: string | null | undefined,
): Promise<number | null> {
  const f = (from || "KZT").toUpperCase();
  const t = (orderCurrency || f).toUpperCase();
  if (f === t) return amount;
  return convertForTenant(amount, f, t);
}

/** Промокод с фиксированной суммой — в валюте заказа; процентный не пересчитывается. */
export async function promoInOrderCurrency<
  P extends { discount_type: PromoDiscountType; discount_value: number },
>(ctx: TenantContext, promo: P, orderCurrency?: string): Promise<P | null> {
  if (promo.discount_type !== "fixed" || !orderCurrency) return promo;
  const v = await toOrderCurrency(promo.discount_value, await shopCurrency(ctx), orderCurrency);
  return v == null ? null : { ...promo, discount_value: v };
}

/**
 * Баллы в валюте заказа: сколько денег дают `balance` баллов (до копеек,
 * вниз), null — курса нет. В валюте магазина — 1 к 1.
 */
export async function pointsInOrderCurrency(
  ctx: TenantContext,
  balance: number,
  orderCurrency?: string,
): Promise<number | null> {
  const shop = await shopCurrency(ctx);
  if (!orderCurrency || shop === orderCurrency.toUpperCase()) return balance;
  const v = await convertForReceipt(balance, shop, orderCurrency);
  return v == null ? null : Math.floor(v);
}

/**
 * Сколько баллов стоит скидка `discount` в валюте заказа: по курсу, вверх,
 * но не больше баланса. null — курса нет.
 */
export async function pointsForDiscount(
  ctx: TenantContext,
  discount: number,
  balance: number,
  orderCurrency?: string,
): Promise<number | null> {
  const shop = await shopCurrency(ctx);
  if (!orderCurrency || shop === orderCurrency.toUpperCase()) return Math.min(balance, discount);
  const back = await convertForReceipt(discount, orderCurrency, shop);
  return back == null ? null : Math.min(balance, Math.ceil(back));
}

/** Списание использования — CAS по used_count: два покупателя не возьмут последнее использование оба. */
export async function redeemPromoCode(
  ctx: TenantContext,
  raw: string,
  subtotal: number,
  orderCurrency?: string,
) {
  const found = await findValidPromoCode(ctx, raw);
  if (!found.ok) return { ok: false as const, reason: "invalid" as const };
  const promo = await promoInOrderCurrency(ctx, found.promo, orderCurrency);
  if (!promo) return { ok: false as const, reason: "fx" as const };
  const discount = computePromoDiscount(subtotal, promo);
  const { data } = await ctx.db
    .from("promo_codes")
    .update({ used_count: found.promo.used_count + 1 })
    .eq("id", found.promo.id)
    .eq("used_count", found.promo.used_count)
    .select("id")
    .maybeSingle();
  if (!data) return { ok: false as const, reason: "invalid" as const };
  return {
    ok: true as const,
    discount,
    promoId: found.promo.id,
    previousUsedCount: found.promo.used_count,
  };
}

/* ── сертификаты ──────────────────────────────────────────────────── */

export async function findValidGift(ctx: TenantContext, raw: string) {
  const { data: c } = await ctx.db
    .from("gift_certificates")
    .select("id, code, amount, currency, status")
    .eq("code", normalizeCode(raw))
    .maybeSingle();
  if (!c || c.status !== "active") return { ok: false as const };
  return {
    ok: true as const,
    certificate: {
      id: c.id,
      code: c.code,
      amount: Number(c.amount),
      currency: c.currency || "KZT",
    },
  };
}

export async function redeemGift(
  ctx: TenantContext,
  raw: string,
  subtotal: number,
  telegramId: number,
  orderCurrency?: string,
) {
  const found = await findValidGift(ctx, raw);
  if (!found.ok) return { ok: false as const, reason: "invalid" as const };
  // Сертификат в своей валюте: на заказ в другой валюте — по курсу.
  const amount = await toOrderCurrency(
    found.certificate.amount,
    found.certificate.currency,
    orderCurrency,
  );
  if (amount == null) return { ok: false as const, reason: "fx" as const };
  const discount = Math.min(subtotal, amount);
  const { data } = await ctx.db
    .from("gift_certificates")
    .update({
      status: "redeemed",
      redeemed_by_telegram_id: telegramId,
      redeemed_at: new Date().toISOString(),
    })
    .eq("id", found.certificate.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (!data) return { ok: false as const, reason: "invalid" as const };
  // Остаток (#257) — в валюте сертификата: доля номинала, не списанная этим
  // заказом, по тому же курсу, по которому считалась скидка.
  const c = found.certificate;
  const rest =
    discount < amount && amount > 0
      ? Math.max(0, Math.round(c.amount * (1 - discount / amount) * 100) / 100)
      : 0;
  return {
    ok: true as const,
    discount,
    certificateId: c.id,
    certificate: c,
    /** Сколько осталось на сертификате, в его валюте; 0 — израсходован целиком. */
    rest,
  };
}

/**
 * Вернуть промокод и сертификат отменённого неоплаченного заказа
 * (rejectOrder после выигранного перехода статуса — один раз на заказ).
 * Сертификат — только если он всё ещё погашен именно этим заказом;
 * счётчик промокода — CAS по прежнему значению, не ниже нуля.
 */
export async function returnOrderCodes(
  ctx: TenantContext,
  orderId: number,
  promoCode: string | null,
): Promise<{ promo: boolean; gift: boolean }> {
  // Остаток сертификата, выданный по этому заказу, — погасить первым: если
  // им уже заплатили, исходный сертификат не возвращаем (иначе вышло бы
  // вдвое больше номинала).
  const { voidGiftRest } = await import("./gift-rest");
  const restVoided = await voidGiftRest(ctx, orderId).catch((e) => {
    console.error(`[discounts] остаток сертификата заказа #${orderId}: ${String(e)}`);
    return false;
  });
  const { data: gift } = !restVoided
    ? { data: [] as Array<{ id: string }> }
    : await ctx.db
        .from("gift_certificates")
        .update({
          status: "active",
          redeemed_order_id: null,
          redeemed_by_telegram_id: null,
          redeemed_at: null,
        })
        .eq("redeemed_order_id", orderId)
        .eq("status", "redeemed")
        .select("id");
  let promo = false;
  if (promoCode) {
    for (let i = 0; i < 5 && !promo; i++) {
      const { data: p } = await ctx.db
        .from("promo_codes")
        .select("id, used_count")
        .eq("code", normalizeCode(promoCode))
        .maybeSingle();
      if (!p || p.used_count <= 0) break;
      const { data: done } = await ctx.db
        .from("promo_codes")
        .update({ used_count: p.used_count - 1 })
        .eq("id", p.id)
        .eq("used_count", p.used_count)
        .select("id")
        .maybeSingle();
      promo = Boolean(done);
    }
  }
  return { promo, gift: (gift?.length ?? 0) > 0 };
}

/* ── баллы ────────────────────────────────────────────────────────── */

export async function loyaltyEarnPercent(ctx: TenantContext): Promise<number> {
  const n = Number(await getSetting(ctx, "loyalty_earn_percent"));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 5;
}

/** Потолок списания баллами, % суммы заказа; не задан — 100 (как в v1). */
export const LOYALTY_MAX_REDEEM_KEY = "loyalty_max_redeem_percent";

export function parseMaxRedeemPercent(raw: string | null | undefined): number {
  if (raw == null || String(raw).trim() === "") return 100;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.floor(n) : 100;
}

export async function loyaltyMaxRedeemPercent(ctx: TenantContext): Promise<number> {
  return parseMaxRedeemPercent(await getSetting(ctx, LOYALTY_MAX_REDEEM_KEY));
}

export async function loyaltyBalance(ctx: TenantContext, telegramId: number): Promise<number> {
  const { data } = await ctx.db
    .from("bot_users")
    .select("loyalty_points")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return Math.max(0, Math.floor(Number(data?.loyalty_points ?? 0)));
}

async function adjustPoints(
  ctx: TenantContext,
  telegramId: number,
  delta: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: u } = await ctx.db
      .from("bot_users")
      .select("loyalty_points")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (!u) return false;
    const current = Number(u.loyalty_points ?? 0);
    if (current + delta < 0) return false;
    const { data } = await ctx.db
      .from("bot_users")
      .update({ loyalty_points: current + delta })
      .eq("telegram_id", telegramId)
      .eq("loyalty_points", current)
      .select("telegram_id")
      .maybeSingle();
    if (data) return true;
  }
  return false;
}

/**
 * Списать баллы на заказ: `points` — сколько баллов ушло с баланса,
 * `discount` — скидка в валюте заказа. Баллы в валюте магазина; на заказ в
 * другой валюте — по курсу. null — курса нет, ничего не списано.
 */
export async function redeemPoints(
  ctx: TenantContext,
  telegramId: number,
  subtotal: number,
  orderCurrency?: string,
): Promise<{ points: number; discount: number } | null> {
  const [balance, maxPercent] = await Promise.all([
    loyaltyBalance(ctx, telegramId),
    loyaltyMaxRedeemPercent(ctx),
  ]);
  const none = { points: 0, discount: 0 };
  if (balance <= 0) return none;
  const shop = await shopCurrency(ctx);
  if (!orderCurrency || shop === orderCurrency.toUpperCase()) {
    const discount = computePointsDiscount(subtotal, balance, maxPercent);
    if (discount <= 0) return none;
    return (await adjustPoints(ctx, telegramId, -discount)) ? { points: discount, discount } : none;
  }
  const worth = await pointsInOrderCurrency(ctx, balance, orderCurrency);
  if (worth == null) return null;
  const discount = computePointsDiscount(subtotal, worth, maxPercent);
  if (discount <= 0) return none;
  const points = await pointsForDiscount(ctx, discount, balance, orderCurrency);
  if (points == null) return null;
  return (await adjustPoints(ctx, telegramId, -points)) ? { points, discount } : none;
}

export async function restorePoints(
  ctx: TenantContext,
  telegramId: number,
  points: number,
): Promise<void> {
  if (points > 0) await adjustPoints(ctx, telegramId, points);
}

/** Начисление за выданный заказ, идемпотентно через orders.points_earned (CAS 0 → N). */
export async function awardPointsForOrder(
  ctx: TenantContext,
  orderId: number,
  telegramId: number,
  total: number,
  currency?: string,
): Promise<number> {
  if (!ctx.tenant.modules.loyalty) return 0;
  // Баллы — в валюте магазина: заказ в другой валюте пересчитывается по
  // курсу; нет курса — не начисляем (не 1 к 1).
  const shop = await shopCurrency(ctx);
  const base =
    !currency || shop === currency.toUpperCase()
      ? total
      : await convertForReceipt(total, currency, shop);
  if (base == null) return 0;
  const points = computePointsEarned(base, await loyaltyEarnPercent(ctx));
  if (points <= 0) return 0;
  const { data: claimed } = await ctx.db
    .from("orders")
    .update({ points_earned: points })
    .eq("id", orderId)
    .eq("points_earned", 0)
    .select("id")
    .maybeSingle();
  if (!claimed) return 0;
  return (await adjustPoints(ctx, telegramId, points)) ? points : 0;
}

/* ── откат при сорвавшемся оформлении ─────────────────────────────── */

export type Redemptions = {
  promo?: { id: string; previousUsedCount: number } | null;
  pointsUsed?: number;
  giftId?: string | null;
  orderId?: number | null;
};

export async function rollbackRedemptions(
  ctx: TenantContext,
  customer: Customer,
  r: Redemptions,
): Promise<void> {
  if (r.promo) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: p } = await ctx.db
        .from("promo_codes")
        .select("used_count")
        .eq("id", r.promo.id)
        .maybeSingle();
      const current = Number(p?.used_count ?? 0);
      if (current <= r.promo.previousUsedCount) break;
      const { data } = await ctx.db
        .from("promo_codes")
        .update({ used_count: current - 1 })
        .eq("id", r.promo.id)
        .eq("used_count", current)
        .select("id")
        .maybeSingle();
      if (data) break;
    }
  }
  if (r.pointsUsed && r.pointsUsed > 0) await restorePoints(ctx, customer.telegramId, r.pointsUsed);
  if (r.giftId) {
    let q = ctx.db
      .from("gift_certificates")
      .update({
        status: "active",
        redeemed_by_telegram_id: null,
        redeemed_at: null,
        redeemed_order_id: null,
      })
      .eq("id", r.giftId)
      .eq("status", "redeemed")
      .eq("redeemed_by_telegram_id", customer.telegramId);
    q = r.orderId
      ? q.or(`redeemed_order_id.eq.${r.orderId},redeemed_order_id.is.null`)
      : q.is("redeemed_order_id", null);
    await q;
  }
}
