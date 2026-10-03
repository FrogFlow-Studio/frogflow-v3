import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingStrict } from "@/core/settings/settings";
import { pageAll } from "@/core/db/page";
import { convertForReceipt } from "@/core/pricing/pricing";

/**
 * Уровни лояльности: до 4 ступеней «сумма выданных покупок от → % начисления».
 * Хранятся в app_settings.loyalty_tiers (JSON). Уровень покупателя считается
 * по его выданным заказам; баллы не пересчитываются — меняется только процент
 * за следующие заказы, а начисление остаётся дельтой (adjustPoints).
 */
export const LOYALTY_TIERS_KEY = "loyalty_tiers";
export const MAX_TIERS = 4;

export type Tier = { name: string; from: number; percent: number };

export type TierStatus = {
  tier: Tier | null;
  next: { tier: Tier; remaining: number } | null;
  spent: number;
};

function validTier(t: unknown): t is Tier {
  if (!t || typeof t !== "object") return false;
  const { name, from, percent } = t as Record<string, unknown>;
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= 40 &&
    typeof from === "number" &&
    Number.isFinite(from) &&
    from >= 0 &&
    typeof percent === "number" &&
    Number.isFinite(percent) &&
    percent > 0 &&
    percent <= 100
  );
}

/** Разбор сохранённого JSON: пусто или не по форме — «уровней нет». */
export function parseTiers(raw: string | null | undefined): Tier[] {
  if (!raw || !raw.trim()) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(json) || json.length > MAX_TIERS || !json.every(validTier)) return [];
  const tiers = json.map((t) => ({ name: t.name.trim(), from: t.from, percent: t.percent }));
  tiers.sort((a, b) => a.from - b.from);
  for (let i = 1; i < tiers.length; i++) if (tiers[i]!.from === tiers[i - 1]!.from) return [];
  return tiers;
}

/** Проверка ввода продавца: понятный отказ вместо молчаливого «не сохранилось». */
export function validateTiers(input: unknown): Tier[] {
  if (!Array.isArray(input) || input.length > MAX_TIERS)
    throw new UserError("err.loyalty.tiers", "Уровней может быть не больше {max}.", {
      max: MAX_TIERS,
    });
  const tiers: Tier[] = [];
  for (const t of input) {
    if (!validTier(t))
      throw new UserError(
        "err.loyalty.tierInvalid",
        "У каждого уровня нужны название (до 40 знаков), сумма от 0 и процент от 1 до 100.",
      );
    tiers.push({ name: t.name.trim(), from: t.from, percent: t.percent });
  }
  tiers.sort((a, b) => a.from - b.from);
  for (let i = 1; i < tiers.length; i++)
    if (tiers[i]!.from === tiers[i - 1]!.from)
      throw new UserError("err.loyalty.tierDup", "Суммы «от» у уровней не должны повторяться.");
  return tiers;
}

/** Уровень по сумме и следующий порог; ниже первого порога уровня нет. */
export function tierStatus(tiers: Tier[], spent: number): TierStatus {
  let tier: Tier | null = null;
  let next: Tier | null = null;
  for (const t of tiers) {
    if (spent >= t.from) tier = t;
    else {
      next = t;
      break;
    }
  }
  return {
    tier,
    next: next ? { tier: next, remaining: Math.round((next.from - spent) * 100) / 100 } : null,
    spent,
  };
}

export async function loyaltyTiers(ctx: TenantContext): Promise<Tier[]> {
  return parseTiers(await getSettingStrict(ctx, LOYALTY_TIERS_KEY));
}

/**
 * Сумма выданных заказов покупателя в валюте магазина. Заказ в другой валюте
 * пересчитывается по курсу; нет курса — в сумму не входит (не 1 к 1).
 * `exceptOrderId` — заказ, за который начисляем: уровень считается ДО него.
 */
export async function deliveredSpent(
  ctx: TenantContext,
  telegramId: number,
  shop: string,
  exceptOrderId?: number,
): Promise<number> {
  const rows = await pageAll<{ id: number; total: number | string; currency: string | null }>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, total, currency")
        .eq("telegram_id", telegramId)
        .eq("status", "delivered")
        .order("id")
        .range(from, to),
    "[loyalty] выданные заказы покупателя",
  );
  const byCurrency = new Map<string, number>();
  for (const r of rows) {
    if (r.id === exceptOrderId) continue;
    const cur = (r.currency || shop).toUpperCase();
    byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + (Number(r.total) || 0));
  }
  let sum = 0;
  for (const [cur, amount] of byCurrency) {
    if (cur === shop) sum += amount;
    else {
      const converted = await convertForReceipt(amount, cur, shop);
      if (converted != null) sum += converted;
    }
  }
  return Math.round(sum * 100) / 100;
}

/** Статус покупателя для экрана бота; null — уровни не заданы. */
export async function customerTierStatus(
  ctx: TenantContext,
  telegramId: number,
  shop: string,
): Promise<TierStatus | null> {
  if (!ctx.tenant.modules.loyalty) return null;
  const tiers = await loyaltyTiers(ctx);
  if (tiers.length === 0) return null;
  return tierStatus(tiers, await deliveredSpent(ctx, telegramId, shop));
}

/**
 * Процент начисления за заказ по уровню покупателя ДО этого заказа; null —
 * уровней нет или покупатель ниже первого порога (берётся общий процент).
 */
export async function tierEarnPercent(
  ctx: TenantContext,
  telegramId: number,
  orderId: number,
  shop: string,
): Promise<number | null> {
  const tiers = await loyaltyTiers(ctx);
  if (tiers.length === 0) return null;
  const spent = await deliveredSpent(ctx, telegramId, shop, orderId);
  return tierStatus(tiers, spent).tier?.percent ?? null;
}
