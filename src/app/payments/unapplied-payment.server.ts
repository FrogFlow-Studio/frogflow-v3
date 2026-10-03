import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  recordUnappliedPayment,
  type UnappliedPayment,
  type UnappliedPaymentKind,
} from "@/core/payments/payment";

/**
 * Шлюз прислал деньги, которые заказ не принял (закрытый заказ, не та сумма
 * или валюта): событие в журнал заказа и одно уведомление продавцу. Зовут все
 * шлюзы — Stripe, NOWPayments, Robokassa, Telegram Stars; повтор колбэка
 * ничего не пишет и не шлёт второй раз.
 */
export async function reportUnappliedPayment(
  ctx: TenantContext,
  order: { id: number; display_no?: number | null; order_no?: number | null },
  kind: UnappliedPaymentKind,
  p: UnappliedPayment,
): Promise<void> {
  const first = await recordUnappliedPayment(ctx, order.id, kind, p);
  if (!first) return;
  const no = order.display_no ?? order.order_no ?? order.id;
  const sum = `${p.amount}${p.currency ? ` ${p.currency}` : ""}`;
  const { escapeHtml } = await import("@/channels/telegram/copy");
  const ref = p.ref ? ` (платёж ${escapeHtml(p.ref)})` : "";
  const text =
    kind === "payment_on_closed"
      ? `⚠️ Оплата ${sum} через ${escapeHtml(p.provider)}${ref} пришла по закрытому заказу #${no}. Свяжитесь с покупателем: выдать заказ или вернуть деньги.`
      : `⚠️ Платёж ${sum} через ${escapeHtml(p.provider)}${ref} не совпал с заказом #${no} по сумме или валюте — заказ не подтверждён. Проверьте кабинет шлюза.`;
  const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
  await notifyAdminsHtml(ctx, text, { orderId: order.id, kind: "delivery_failure" }).catch((e) =>
    console.error(`[payments] уведомление по заказу #${order.id}`, e),
  );
}
