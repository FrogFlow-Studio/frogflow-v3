import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings } from "@/core/settings/settings";
import { convertForTenant } from "@/core/pricing/pricing";

/**
 * Оплата Telegram Stars (модуль telegram_stars): счёт `sendInvoice` в валюте
 * XTR без платёжного провайдера. Сколько звёзд — по курсу продавца «1 ⭐ =
 * X в валюте магазина» (`app_settings.stars_rate`); заказ в другой валюте
 * сначала переводится в валюту магазина. Округление вверх: продавец не
 * должен терять на копейках. Проверка суммы — перед оплатой
 * (`pre_checkout_query`) и после (`successful_payment`).
 */
export const STARS_PAYLOAD_PREFIX = "order:";

export function parseStarsRate(raw: string | null | undefined): number | null {
  const n = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
}

export function starsFor(amount: number, rate: number): number {
  return Math.max(1, Math.ceil(amount / rate - 1e-9));
}

export function starsPayload(orderId: number): string {
  return `${STARS_PAYLOAD_PREFIX}${orderId}`;
}

export function parseStarsPayload(payload: string | null | undefined): number | null {
  if (!payload?.startsWith(STARS_PAYLOAD_PREFIX)) return null;
  const id = Number(payload.slice(STARS_PAYLOAD_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function starsRate(ctx: TenantContext): Promise<number | null> {
  if (!ctx.tenant.modules.telegram_stars) return null;
  const s = await getSettings(ctx, ["stars_rate"]);
  return parseStarsRate(s.stars_rate);
}

/** Сколько звёзд за сумму заказа; null — Stars не настроены или нет курса валют. */
export async function starsForOrder(
  ctx: TenantContext,
  due: number,
  currency: string,
): Promise<number | null> {
  const rate = await starsRate(ctx);
  if (!rate) return null;
  const s = await getSettings(ctx, ["shop_currency"]);
  const shopCurrency = (s.shop_currency ?? "KZT").toUpperCase();
  const amount =
    currency.toUpperCase() === shopCurrency
      ? due
      : await convertForTenant(due, currency, shopCurrency);
  return amount == null ? null : starsFor(amount, rate);
}
