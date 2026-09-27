import type { TenantContext } from "@/core/tenant/resolve.server";
import { getOrder } from "@/core/orders/orders";
import { orderChannel } from "@/core/orders/pure";

/**
 * Шлюз подтвердил оплату (markPaidOnline уже отметил заказ): выдать и сообщить
 * в канале заказа. Telegram — своим путём (сообщение «оплата получена»,
 * вопрос языка). Instagram/WhatsApp и сайт — тем же «подтвердить и выдать»,
 * что у продавца и у очереди повторов: раньше их оплаченный картой заказ так
 * и оставался «оплачен» без выдачи.
 */
export async function afterPaidOnline(ctx: TenantContext, orderId: number): Promise<void> {
  const order = await getOrder(ctx, orderId);
  if (!order) return;
  const channel = orderChannel(order.platform);
  if (channel === "telegram") {
    const { env } = await import("@/config/env");
    const { telegramApi } = await import("@/channels/telegram/api");
    const { onOrderPaid } = await import("@/channels/telegram/handle-update");
    await onOrderPaid(
      ctx,
      telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE),
      orderId,
    );
    return;
  }
  if (order.fulfillment_kind !== "physical") {
    const { runOrderAction } = await import("@/app/admin/admin.server");
    const r = await runOrderAction(ctx, orderId, "confirm", "robokassa");
    if (!r.ok) {
      const { notifyDeliveryFailure } = await import("@/channels/telegram/notify");
      await notifyDeliveryFailure(ctx, order, { sent: 0, failed: 1 });
    }
  }
  const { adminTelegramApi } = await import("@/channels/telegram/notify");
  const api = adminTelegramApi(ctx);
  if (!api) return;
  const { notifyAdminNewOrder } = await import("@/channels/telegram/admin-notify");
  await notifyAdminNewOrder(ctx, api, (await getOrder(ctx, orderId)) ?? order, null, {
    paidOnline: true,
  });
}
