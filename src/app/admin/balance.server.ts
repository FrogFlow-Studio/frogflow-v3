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
  return notifyBuyer(ctx, orderId, (m, no) => m.balanceProofRejected(no));
}

/** Остаток оплачен картой — покупателю в его канал на его языке. */
export async function notifyBalancePaid(
  ctx: TenantContext,
  orderId: number,
  amount: number,
): Promise<{ notified: boolean }> {
  const { formatMoney } = await import("@/core/money/money");
  return notifyBuyer(ctx, orderId, (m, no, currency) =>
    m.balancePaid(no, formatMoney(amount, currency)),
  );
}

async function notifyBuyer(
  ctx: TenantContext,
  orderId: number,
  text: (
    m: (typeof import("@/channels/telegram/copy"))["COPY"]["ru"],
    no: number,
    currency: string,
  ) => string,
): Promise<{ notified: boolean }> {
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
  const { notifyCustomer } = await import("./admin.server");
  return {
    notified: await notifyCustomer(
      ctx,
      order,
      text(COPY[locale] ?? COPY.ru, displayNo(order), order.currency),
    ),
  };
}
