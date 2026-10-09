import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import { type SubscriptionWithTariff } from "./vip-model";

/** Чтение подписок. */

/* ── подписки: чтение ───────────────────────────────────────────────── */

const WITH_TARIFF = "*, vip_tariffs(*)";

export async function activeSubscription(
  ctx: TenantContext,
  telegramId: number,
  now = new Date(),
): Promise<SubscriptionWithTariff | null> {
  const { data, error } = await ctx.db
    .from("vip_subscriptions")
    .select(WITH_TARIFF)
    .eq("telegram_id", telegramId)
    .eq("status", "active")
    .gt("expires_at", now.toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`VIP: действующая подписка: ${error.message}`);
  return (data as SubscriptionWithTariff | null) ?? null;
}

export async function pendingSubscription(
  ctx: TenantContext,
  telegramId: number,
): Promise<SubscriptionWithTariff | null> {
  const { data, error } = await ctx.db
    .from("vip_subscriptions")
    .select(WITH_TARIFF)
    .eq("telegram_id", telegramId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(error.message);
  return (data as SubscriptionWithTariff | null) ?? null;
}

/** Был ли когда-нибудь оплаченный доступ (active/expired) — тогда «первый вход» недоступен. */
export async function hadPaidAccess(ctx: TenantContext, telegramId: number): Promise<boolean> {
  const { count, error } = await ctx.db
    .from("vip_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramId)
    .in("status", ["active", "expired"]);
  if (error) throw serverFailure(`VIP: была ли оплата: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function getSubscription(
  ctx: TenantContext,
  id: string,
): Promise<SubscriptionWithTariff | null> {
  const { data, error } = await ctx.db
    .from("vip_subscriptions")
    .select(WITH_TARIFF)
    .eq("id", id)
    .maybeSingle();
  if (error) throw serverFailure(`VIP: подписка: ${error.message}`);
  return (data as SubscriptionWithTariff | null) ?? null;
}

/** Все подписки постранично: список продавца не обрезается на N последних. */
export async function listSubscriptions(
  ctx: TenantContext,
  filter: { status?: string; q?: string } = {},
): Promise<SubscriptionWithTariff[]> {
  const t = filter.q?.trim().replace(/[%,()]/g, "");
  return pageAll<SubscriptionWithTariff>((from, to) => {
    let q = ctx.db
      .from("vip_subscriptions")
      .select(WITH_TARIFF)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (filter.status) q = q.eq("status", filter.status);
    if (t) {
      q = /^\d+$/.test(t)
        ? q.eq("telegram_id", Number(t))
        : q.or(`username.ilike.%${t}%,first_name.ilike.%${t}%,last_name.ilike.%${t}%`);
    }
    return q as unknown as PromiseLike<{
      data: SubscriptionWithTariff[] | null;
      error: { message: string } | null;
    }>;
  }, "VIP: список подписок");
}
