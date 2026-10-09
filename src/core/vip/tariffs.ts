import type { TenantContext } from "@/core/tenant/resolve.server";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import { type MemberUser, type TariffRow } from "./vip-model";

/** Тарифы, тариф и язык участника. */

/* ── тарифы ─────────────────────────────────────────────────────────── */

export async function listTariffs(ctx: TenantContext): Promise<TariffRow[]> {
  const { data, error } = await ctx.db.from("vip_tariffs").select("*").order("sort_order");
  if (error) throw serverFailure(error.message);
  return data ?? [];
}

/** Публичные активные тарифы продления — без пакета «первый вход». */
export async function renewTariffs(ctx: TenantContext): Promise<TariffRow[]> {
  return (await listTariffs(ctx)).filter((t) => t.is_active && t.is_public && !t.is_entry);
}

export async function entryTariff(ctx: TenantContext): Promise<TariffRow | null> {
  const { data, error } = await ctx.db
    .from("vip_tariffs")
    .select("*")
    .eq("is_entry", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`VIP: тариф «первый вход»: ${error.message}`);
  return data ?? null;
}

export async function getTariff(ctx: TenantContext, id: string): Promise<TariffRow | null> {
  const { data, error } = await ctx.db.from("vip_tariffs").select("*").eq("id", id).maybeSingle();
  if (error) throw serverFailure(`VIP: тариф: ${error.message}`);
  return data ?? null;
}

export type TariffInput = {
  id?: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  duration_days: number;
  duration_minutes?: number | null;
  is_active: boolean;
  is_public: boolean;
  is_entry: boolean;
  sort_order: number;
};

/** Пакет «первый вход» — один на клиента: флаг снимается с остальных. */
export async function saveTariff(ctx: TenantContext, input: TariffInput): Promise<string> {
  if (input.is_entry) {
    let q = ctx.db.from("vip_tariffs").update({ is_entry: false }).eq("is_entry", true);
    if (input.id) q = q.neq("id", input.id);
    const { error } = await q;
    if (error) throw serverFailure(error.message);
  }
  const payload = {
    name: input.name,
    description: input.description ?? "",
    price: input.price,
    currency: input.currency,
    duration_days: input.duration_days,
    duration_minutes: input.duration_minutes ?? null,
    is_active: input.is_active,
    is_public: input.is_entry ? false : input.is_public,
    is_entry: input.is_entry,
    sort_order: input.is_entry ? -100 : input.sort_order,
  };
  if (input.id) {
    const { error } = await ctx.db.from("vip_tariffs").update(payload).eq("id", input.id);
    if (error) throw serverFailure(error.message);
    return input.id;
  }
  const { data, error } = await ctx.db
    .from("vip_tariffs")
    .insert({ ...payload, bot_id: ctx.tenant.id })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  return data.id;
}

export async function deleteTariff(ctx: TenantContext, id: string): Promise<void> {
  const { count, error: countError } = await ctx.db
    .from("vip_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("tariff_id", id);
  if (countError) throw serverFailure(`VIP: подписки тарифа: ${countError.message}`);
  if ((count ?? 0) > 0)
    throw new UserError(
      "err.vip.tariffHasSubscriptions",
      "По тарифу есть подписки — выключите его, а не удаляйте.",
    );
  const { error } = await ctx.db.from("vip_tariffs").delete().eq("id", id);
  if (error) throw serverFailure(error.message);
}

/* ── профиль участника ──────────────────────────────────────────────── */

export async function assignMemberTariff(
  ctx: TenantContext,
  telegramId: number,
  user: MemberUser,
  tariffId: string,
  source: "deep_link" | "payment" | "admin",
): Promise<void> {
  const { error } = await ctx.db.from("vip_member_profiles").upsert(
    {
      bot_id: ctx.tenant.id,
      telegram_id: telegramId,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      assigned_tariff_id: tariffId,
      assigned_at: new Date().toISOString(),
      assigned_source: source,
    },
    { onConflict: "bot_id,telegram_id" },
  );
  if (error) console.error("[vip] assign tariff failed", error.message);
}

/** Персональный (скрытый) тариф участника, если он ещё активен. */
export async function memberAssignedTariff(
  ctx: TenantContext,
  telegramId: number,
): Promise<TariffRow | null> {
  const { data, error } = await ctx.db
    .from("vip_member_profiles")
    .select("assigned_tariff_id, vip_tariffs(*)")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (error) throw serverFailure(`VIP: персональный тариф: ${error.message}`);
  const t = (data?.vip_tariffs as TariffRow | null) ?? null;
  return data?.assigned_tariff_id && t?.is_active ? t : null;
}

/** Язык покупателя VIP-бота — выбран явно, не по языку устройства; null — первый контакт. */
export async function memberLocale(ctx: TenantContext, telegramId: number): Promise<Locale | null> {
  const { data, error } = await ctx.db
    .from("vip_member_profiles")
    .select("locale")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (error) throw serverFailure(`VIP: язык участника: ${error.message}`);
  return isLocale(data?.locale) ? data!.locale : null;
}

export async function setMemberLocale(
  ctx: TenantContext,
  telegramId: number,
  user: MemberUser,
  locale: Locale,
): Promise<void> {
  const { error } = await ctx.db.from("vip_member_profiles").upsert(
    {
      bot_id: ctx.tenant.id,
      telegram_id: telegramId,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      locale,
    },
    { onConflict: "bot_id,telegram_id" },
  );
  if (error) console.error("[vip] set locale failed", error.message);
}
