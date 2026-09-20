import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { getSetting } from "@/core/settings/settings";
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

/** Списание использования — CAS по used_count: два покупателя не возьмут последнее использование оба. */
export async function redeemPromoCode(ctx: TenantContext, raw: string, subtotal: number) {
  const found = await findValidPromoCode(ctx, raw);
  if (!found.ok) return { ok: false as const };
  const discount = computePromoDiscount(subtotal, found.promo);
  const { data } = await ctx.db
    .from("promo_codes")
    .update({ used_count: found.promo.used_count + 1 })
    .eq("id", found.promo.id)
    .eq("used_count", found.promo.used_count)
    .select("id")
    .maybeSingle();
  if (!data) return { ok: false as const };
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
    .select("id, amount, status")
    .eq("code", normalizeCode(raw))
    .maybeSingle();
  if (!c || c.status !== "active") return { ok: false as const };
  return { ok: true as const, certificate: { id: c.id, amount: Number(c.amount) } };
}

export async function redeemGift(
  ctx: TenantContext,
  raw: string,
  subtotal: number,
  telegramId: number,
) {
  const found = await findValidGift(ctx, raw);
  if (!found.ok) return { ok: false as const };
  const discount = Math.min(subtotal, found.certificate.amount);
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
  if (!data) return { ok: false as const };
  return { ok: true as const, discount, certificateId: found.certificate.id };
}

/* ── баллы ────────────────────────────────────────────────────────── */

export async function loyaltyEarnPercent(ctx: TenantContext): Promise<number> {
  const n = Number(await getSetting(ctx, "loyalty_earn_percent"));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 5;
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

export async function redeemPoints(
  ctx: TenantContext,
  telegramId: number,
  subtotal: number,
): Promise<number> {
  const balance = await loyaltyBalance(ctx, telegramId);
  const discount = computePointsDiscount(subtotal, balance);
  if (discount <= 0) return 0;
  return (await adjustPoints(ctx, telegramId, -discount)) ? discount : 0;
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
): Promise<number> {
  if (!ctx.tenant.modules.loyalty) return 0;
  const points = computePointsEarned(total, await loyaltyEarnPercent(ctx));
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
