import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";

/**
 * Продавец не принял чек на остаток по задатку: ожидание снято
 * (core/orders/balance), покупателю — сообщение в его канал на его языке.
 */
export async function rejectBalanceProofAndNotify(
  ctx: TenantContext,
  orderId: number,
  actor: string,
): Promise<{ notified: boolean }> {
  const { rejectBalanceProof } = await import("@/core/orders/balance");
  if (!(await rejectBalanceProof(ctx, orderId, actor)))
    throw new UserError("err.orders.noBalanceProof", "Чека на остаток, который ждёт проверки, нет");
  const { getOrder, displayNo } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, orderId);
  if (!order) return { notified: false };
  const { COPY } = await import("@/channels/telegram/copy");
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const { isLocale } = await import("@/core/i18n/locale");
  const buyer = await getCustomerByTelegramId(ctx, Number(order.telegram_id));
  const locale = isLocale(buyer?.state.locale)
    ? buyer.state.locale
    : (ctx.tenant.settings.default_locale ?? "ru");
  const text = (COPY[locale] ?? COPY.ru).balanceProofRejected(displayNo(order));
  const { notifyCustomer } = await import("./admin.server");
  return { notified: await notifyCustomer(ctx, order, text) };
}
