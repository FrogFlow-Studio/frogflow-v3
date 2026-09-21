import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting } from "@/core/settings/settings";

/**
 * Реферальная программа: ссылка t.me/<бот>?start=ref_<telegram_id> —
 * свой id и есть код. Награда обеим сторонам — персональный одноразовый
 * промокод: приглашённому сразу при первом /start по ссылке, пригласившему —
 * когда у приглашённого случилась первая выданная покупка.
 * Ядро только пишет в базу и возвращает, что сказать; отправляет канал.
 */
export const REFERRAL_PREFIX = "ref_";

export type ReferralGrant = { telegramId: number; code: string; percent: number };

export async function referralPercent(ctx: TenantContext): Promise<number> {
  const n = Number(await getSetting(ctx, "referral_discount_percent"));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 10;
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function issuePersonalPromo(
  ctx: TenantContext,
  prefix: string,
  percent: number,
): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = `${prefix}-${suffix()}`;
    const { error } = await ctx.db.from("promo_codes").insert({
      bot_id: ctx.tenant.id,
      code,
      discount_type: "percent",
      discount_value: percent,
      max_uses: 1,
      is_active: true,
    });
    if (!error) return code;
  }
  return null;
}

/**
 * /start ref_<id>: идемпотентно — UNIQUE(bot_id, referred_telegram_id) не даст
 * второй записи. Возвращает подарок приглашённому или null.
 */
export async function registerReferral(
  ctx: TenantContext,
  referredId: number,
  referrerRaw: string,
): Promise<ReferralGrant | null> {
  if (!ctx.tenant.modules.referral) return null;
  const referrerId = Number(referrerRaw);
  if (!Number.isFinite(referrerId) || referrerId <= 0 || referrerId === referredId) return null;
  // Реферер — реальный покупатель этого же бота, иначе ссылка чужая.
  const { data: referrer } = await ctx.db
    .from("bot_users")
    .select("telegram_id")
    .eq("telegram_id", referrerId)
    .maybeSingle();
  if (!referrer) return null;
  const { error } = await ctx.db.from("referrals").insert({
    bot_id: ctx.tenant.id,
    referrer_telegram_id: referrerId,
    referred_telegram_id: referredId,
  });
  if (error) return null;
  const percent = await referralPercent(ctx);
  const code = await issuePersonalPromo(ctx, "WELCOME", percent);
  return code ? { telegramId: referredId, code, percent } : null;
}

/**
 * После выдачи заказа: наградить пригласившего один раз, на первой выданной
 * покупке приглашённого после перехода по ссылке. CAS pending→rewarded.
 */
export async function rewardReferrerIfFirstDelivery(
  ctx: TenantContext,
  referredId: number,
): Promise<ReferralGrant | null> {
  if (!ctx.tenant.modules.referral) return null;
  const { data: ref } = await ctx.db
    .from("referrals")
    .select("id, referrer_telegram_id, status, created_at")
    .eq("referred_telegram_id", referredId)
    .maybeSingle();
  if (!ref || ref.status !== "pending") return null;
  const { count } = await ctx.db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", referredId)
    .eq("status", "delivered")
    .gte("created_at", ref.created_at);
  if ((count ?? 0) < 1) return null;
  const { data: claimed } = await ctx.db
    .from("referrals")
    .update({ status: "rewarded", rewarded_at: new Date().toISOString() })
    .eq("id", ref.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return null;
  const percent = await referralPercent(ctx);
  const code = await issuePersonalPromo(ctx, "REF", percent);
  if (!code) return null;
  await ctx.db.from("referrals").update({ reward_promo_code: code }).eq("id", ref.id);
  return { telegramId: Number(ref.referrer_telegram_id), code, percent };
}
