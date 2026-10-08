/** Общие помощники серверных функций админки: плашки пробного периода и подписки. */

/** Плашка пробного периода. Сбой чтения срока не должен выкидывать продавца из админки — без плашки. */
export async function trialBanner(ctx: import("@/core/tenant/resolve.server").TenantContext) {
  try {
    const { todayInTz } = await import("@/core/fulfillment/pure");
    const today = todayInTz(ctx.timezone);
    const until = ctx.tenant.settings.billing?.trial_until;
    if (!until || until < today) return null;
    const { subscriptionExpiresAt } = await import("@/app/operator/billing.server");
    const { trialState, afterTrial } = await import("@/core/plans/trial");
    const { readPolicy } = await import("@/core/billing/subscription");
    const state = trialState(
      ctx.tenant.settings.billing,
      await subscriptionExpiresAt(ctx.tenant.id),
      today,
    );
    return state ? { ...state, after: afterTrial(readPolicy(ctx.tenant.settings)) } : null;
  } catch (e) {
    console.warn(`[admin] плашка пробного периода ${ctx.tenant.id}:`, e);
    return null;
  }
}

/** Срок подписки продавцу: до какого дня оплачено и что будет. Сбой чтения не должен выкидывать из админки — без плашки. */
export async function subscriptionView(ctx: import("@/core/tenant/resolve.server").TenantContext) {
  try {
    const { subscriptionExpiresAt } = await import("@/app/operator/billing.server");
    const { readPolicy } = await import("@/core/billing/subscription");
    const { sellerSubscription } = await import("@/core/billing/seller-status");
    return sellerSubscription(
      await subscriptionExpiresAt(ctx.tenant.id),
      readPolicy(ctx.tenant.settings),
      ctx.tenant.status === "suspended",
    );
  } catch (e) {
    console.warn(`[admin] срок подписки ${ctx.tenant.id}:`, e);
    return null;
  }
}
