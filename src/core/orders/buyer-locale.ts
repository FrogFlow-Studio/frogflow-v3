import { getCustomer } from "@/core/customers/customers";
import { isLocale, type Locale } from "@/core/i18n/locale";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Язык, на котором покупателю пишет продавец от имени магазина (отклонение,
 * принятие, возврат, выдача): выбранный в диалоге, иначе язык магазина по
 * умолчанию, иначе русский — как `localeOf` в диалоге бота.
 */
export async function orderBuyerLocale(
  ctx: TenantContext,
  order: { user_key?: string | null; telegram_id: number | string | null },
): Promise<Locale> {
  const key = order.user_key ?? `tg_${order.telegram_id}`;
  const customer = await getCustomer(ctx, key).catch(() => null);
  const chosen = customer?.state.locale;
  if (isLocale(chosen)) return chosen;
  return ctx.tenant.settings.default_locale ?? "ru";
}
