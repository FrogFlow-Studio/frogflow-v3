import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AI_TOPUP_MAX_USD, AI_TOPUP_MIN_USD } from "@/core/ai/pure";

/**
 * «ИИ-баланс» продавца: сколько осталось, журнал пополнений и расхода,
 * пополнение счётом через Kaspi (app/operator/ai-topup.server). Смотреть —
 * любой роли магазина, пополнять — только владельцу: счёт уходит в его бота.
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const adminOwner = async () => (await import("@/app/auth/guards.server")).requireAdminRole("owner");
const actor = async () => (await import("@/app/auth/guards.server")).adminActor();

export const aiBalanceFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { aiBalancePeek, aiJournal } = await import("@/core/ai/balance");
  const { AI_START_USD } = await import("@/core/ai/pure");
  const { convertForTenant } = await import("@/core/pricing/pricing");
  const [balance, journal, kztPer100] = await Promise.all([
    aiBalancePeek(ctx),
    aiJournal(ctx, 60),
    convertForTenant(100, "USD", "KZT").catch(() => null),
  ]);
  return {
    // Строки ещё нет — стартовые 5 $ начислятся при первом обращении к ИИ.
    usd: balance?.usd ?? AI_START_USD,
    started: Boolean(balance),
    journal,
    kztPerUsd: kztPer100 ? kztPer100 / 100 : null,
    min: AI_TOPUP_MIN_USD,
    max: AI_TOPUP_MAX_USD,
  };
});

/** Карточка баланса на главной: только владельцу, без журнала и курса. */
export const aiBalanceCardFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await adminOwner();
  const { aiBalancePeek } = await import("@/core/ai/balance");
  const { AI_START_USD } = await import("@/core/ai/pure");
  const balance = await aiBalancePeek(ctx);
  return { usd: balance?.usd ?? AI_START_USD, started: Boolean(balance) };
});

export const aiTopupFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ usd: z.number().min(AI_TOPUP_MIN_USD).max(AI_TOPUP_MAX_USD) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { createAiTopup } = await import("@/app/operator/ai-topup.server");
    const { qrSvg } = await import("@/core/billing/pay/kaspi-link");
    const r = await createAiTopup(ctx.tenant.id, data.usd, await actor());
    return { ...r, qr: r.payUrl ? qrSvg(r.payUrl) : null };
  });
