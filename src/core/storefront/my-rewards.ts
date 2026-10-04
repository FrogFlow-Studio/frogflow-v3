import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * «Мои баллы и приглашения» в Mini App и на сайте для вошедшего через
 * Telegram: то же, что покупатель видит в боте (экран «Баллы» и «Пригласить
 * друга»). Данные только свои — по подписанному initData или входу через
 * Telegram; почта заказа сюда не ведёт (её никто не подтверждал).
 * Баллы на витрине только копятся, тратятся в боте.
 */
export type MyRewards = {
  /** Модуль лояльности включён: баланс, процент и уровень. */
  points: {
    balance: number;
    currency: string;
    earnPercent: number;
    maxRedeemPercent: number;
    tier: { name: string; percent: number } | null;
    next: { name: string; remaining: number } | null;
  } | null;
  /** Модуль рефералов включён и у бота есть имя: личная ссылка и итоги. */
  invite: {
    link: string;
    came: number;
    bought: number;
    codes: Array<{ code: string; used: boolean }>;
  } | null;
};

export async function myRewards(ctx: TenantContext, telegramId: number): Promise<MyRewards> {
  const mod = ctx.tenant.modules;
  let points: MyRewards["points"] = null;
  if (mod.loyalty) {
    const { getSettingStrict } = await import("@/core/settings/settings");
    const {
      LOYALTY_MAX_REDEEM_KEY,
      loyaltyBalance,
      loyaltyEarnPercent,
      parseMaxRedeemPercent,
      shopCurrency,
    } = await import("@/core/discounts/discounts");
    const { customerTierStatus } = await import("@/core/loyalty/tiers");
    const [balance, maxRaw, currency, percent] = await Promise.all([
      loyaltyBalance(ctx, telegramId),
      getSettingStrict(ctx, LOYALTY_MAX_REDEEM_KEY),
      shopCurrency(ctx),
      loyaltyEarnPercent(ctx),
    ]);
    const status = await customerTierStatus(ctx, telegramId, currency);
    points = {
      balance,
      currency,
      earnPercent: status?.tier?.percent ?? percent,
      maxRedeemPercent: parseMaxRedeemPercent(maxRaw),
      tier: status?.tier ? { name: status.tier.name, percent: status.tier.percent } : null,
      next: status?.next ? { name: status.next.tier.name, remaining: status.next.remaining } : null,
    };
  }
  let invite: MyRewards["invite"] = null;
  const bot = ctx.tenant.settings.telegram?.username;
  // Покупатель Instagram/WhatsApp (вошёл по коду) в Telegram не пришёл: ссылки-приглашения у него нет.
  if (mod.referral && bot && telegramId > 0) {
    const { REFERRAL_PREFIX, referralStats } = await import("@/core/referrals/referrals");
    const stats = await referralStats(ctx, telegramId);
    invite = {
      link: `https://t.me/${bot}?start=${REFERRAL_PREFIX}${telegramId}`,
      came: stats.came,
      bought: stats.bought,
      codes: stats.codes,
    };
  }
  return { points, invite };
}
