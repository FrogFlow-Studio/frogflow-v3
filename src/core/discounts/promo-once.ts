import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { updateSettingAtomic } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";

/**
 * Промокод «один раз на покупателя». Флаг — список id промокодов в
 * app_settings (колонки у promo_codes нет, схема не меняется). Использованием
 * считается заказ покупателя с этим кодом, кроме отменённых и отклонённых:
 * брошенный заказ возвращает код (rejectOrder), и покупатель может взять его
 * снова. Покупатель — user_key; покупатель сайта по почте — ещё и почта в
 * заказе (код даёт только скидку, неподтверждённой почты для этого хватает).
 */
export const PROMO_ONCE_KEY = "promo_once_per_buyer";

export type PromoBuyer = Pick<Customer, "userKey" | "platform" | "email">;

export function parsePromoOnce(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Промокоды с флагом. Читаем сами, а не через getSetting: тот при сбое базы
 * отдаёт пусто, и «один раз» молча пропустил бы повтор — здесь сбой.
 */
export async function promoOnceIds(ctx: TenantContext): Promise<Set<string>> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", PROMO_ONCE_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`[promo] флаг «один раз на покупателя»: ${error.message}`);
  return new Set(parsePromoOnce(data?.value));
}

/** Включить или снять флаг у промокода; false — настройку записать не удалось. */
export async function setPromoOnce(ctx: TenantContext, promoId: string, on: boolean) {
  const r = await updateSettingAtomic(ctx, PROMO_ONCE_KEY, (raw) => {
    const ids = parsePromoOnce(raw);
    const has = ids.includes(promoId);
    if (has === on) return null;
    return JSON.stringify(on ? [...ids, promoId] : ids.filter((x) => x !== promoId));
  });
  return r !== "failed";
}

const CLOSED = "(cancelled,rejected)";

/** Покупатель уже брал этот код (нормализованный) в заказе, который не отменён. */
export async function buyerUsedPromo(
  ctx: TenantContext,
  code: string,
  buyer: PromoBuyer,
): Promise<boolean> {
  const byKey = await ctx.db
    .from("orders")
    .select("id")
    .eq("promo_code", code)
    .eq("user_key", buyer.userKey)
    .not("status", "in", CLOSED)
    .limit(1);
  if (byKey.error) throw serverFailure(`[promo] заказы покупателя: ${byKey.error.message}`);
  if (byKey.data?.length) return true;
  const email = buyer.platform === "web" ? buyer.email?.trim().toLowerCase() : null;
  if (!email) return false;
  const byEmail = await ctx.db
    .from("orders")
    .select("id")
    .eq("promo_code", code)
    .eq("customer_email", email)
    .not("status", "in", CLOSED)
    .limit(1);
  if (byEmail.error) throw serverFailure(`[promo] заказы по почте: ${byEmail.error.message}`);
  return Boolean(byEmail.data?.length);
}
