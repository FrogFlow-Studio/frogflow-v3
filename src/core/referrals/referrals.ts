import { serverFailure } from "@/lib/server-failure";
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
    // Занятый код — пробуем другой; любой иной сбой не прячем за «не получилось».
    if (error.code !== "23505") throw serverFailure(`[referral] выпуск кода: ${error.message}`);
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
  const { data: referrer, error: referrerError } = await ctx.db
    .from("bot_users")
    .select("telegram_id")
    .eq("telegram_id", referrerId)
    .maybeSingle();
  if (referrerError) throw serverFailure(`[referral] реферер: ${referrerError.message}`);
  if (!referrer) return null;
  const { error } = await ctx.db.from("referrals").insert({
    bot_id: ctx.tenant.id,
    referrer_telegram_id: referrerId,
    referred_telegram_id: referredId,
  });
  // 23505 — уже записан (повтор /start); любой другой сбой — не «ссылка не сработала».
  if (error) {
    if (error.code === "23505") return null;
    throw serverFailure(`[referral] запись приглашения: ${error.message}`);
  }
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
  const { data: ref, error: refError } = await ctx.db
    .from("referrals")
    .select("id, referrer_telegram_id, status, created_at")
    .eq("referred_telegram_id", referredId)
    .maybeSingle();
  // Награда не выдаётся по упавшему чтению: сбой наружу, повтор — на следующей выдаче.
  if (refError) throw serverFailure(`[referral] чтение приглашения: ${refError.message}`);
  if (!ref || ref.status !== "pending") return null;
  const { count, error: countError } = await ctx.db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", referredId)
    .eq("status", "delivered")
    .gte("created_at", ref.created_at);
  if (countError) throw serverFailure(`[referral] выданные заказы: ${countError.message}`);
  if ((count ?? 0) < 1) return null;
  const { data: claimed, error: claimError } = await ctx.db
    .from("referrals")
    .update({ status: "rewarded", rewarded_at: new Date().toISOString() })
    .eq("id", ref.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) throw serverFailure(`[referral] отметка награды: ${claimError.message}`);
  if (!claimed) return null;
  // Отметка уже поставлена; не вышло выпустить код — вернуть «ожидает»,
  // чтобы награда не пропала и ушла на следующей выдаче.
  const release = () =>
    ctx.db
      .from("referrals")
      .update({ status: "pending", rewarded_at: null })
      .eq("id", ref.id)
      .eq("status", "rewarded")
      .is("reward_promo_code", null);
  let percent: number;
  let code: string | null;
  try {
    percent = await referralPercent(ctx);
    code = await issuePersonalPromo(ctx, "REF", percent);
  } catch (e) {
    await release();
    throw e;
  }
  if (!code) {
    await release();
    return null;
  }
  const saved = await ctx.db.from("referrals").update({ reward_promo_code: code }).eq("id", ref.id);
  // Код уже выдан — награду отдаём, а не теряем; сбой записи кода только в журнал.
  if (saved.error) console.error("[referral] код награды не записан", saved.error.message);
  return { telegramId: Number(ref.referrer_telegram_id), code, percent };
}
