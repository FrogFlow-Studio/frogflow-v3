import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Платёжный шлюз сообщил о возврате денег покупателю (NOWPayments `refunded`):
 * возвращаем в заказе ровно ту сумму, которую этот платёж принёс (событие
 * `payment` с номером платежа, его пишет markPaidOnline), но не больше остатка,
 * и снимаем доступ к закрытому каналу курса, как при возврате из админки.
 * Платежа в истории нет (недоплата, чужой счёт) — заказ не трогаем:
 * "unmatched", продавцу решать. Уже возвращённый платёж — "skipped".
 */
export async function applyProviderRefund(
  ctx: TenantContext,
  orderId: number,
  provider: string,
  paymentRef: string,
): Promise<"refunded" | "skipped" | "unmatched"> {
  const { data: o, error } = await ctx.db
    .from("orders")
    .select("id, status, total, paid_amount, fulfillment_kind")
    .eq("id", orderId)
    .maybeSingle();
  const { serverFailure } = await import("@/lib/server-failure");
  if (error) throw serverFailure(`Заказ не прочитан: ${error.message}`);
  const { REFUNDABLE_STATUSES, receivedAmount, refundOrder } = await import("@/core/orders/refund");
  if (!o) return "skipped";

  const { pageAll } = await import("@/core/db/page");
  const events = await pageAll<{ id: string; event_type: string; payload: unknown }>(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, event_type, payload")
        .eq("status", "event")
        .in("event_type", ["order.payment", "order.refund"])
        .eq("payload->>order_id", String(orderId))
        .order("id")
        .range(from, to),
    "история заказа для возврата",
  );
  const payload = (e: { payload: unknown }) => (e.payload ?? {}) as Record<string, unknown>;
  const paid = events.find(
    (e) =>
      e.event_type === "order.payment" &&
      payload(e).provider === provider &&
      String(payload(e).invId ?? "") === paymentRef,
  );
  if (!paymentRef || !paid) return "unmatched";
  const marker = `платёж ${paymentRef}`;
  const refunds = events.filter((e) => e.event_type === "order.refund");
  if (refunds.some((e) => String(payload(e).reason ?? "").includes(marker))) return "skipped";
  if (!(REFUNDABLE_STATUSES as readonly string[]).includes(o.status)) return "skipped";
  const refunded = refunds.reduce((sum, e) => sum + (Number(payload(e).amount) || 0), 0);
  const remaining = Math.round((receivedAmount(o) - refunded) * 100) / 100;
  const amount = Math.min(Number(payload(paid).amount) || 0, remaining);
  if (!(amount > 0)) return "skipped";
  const r = await refundOrder(
    ctx,
    orderId,
    { amount, reason: `Возврат через ${provider}, ${marker}` },
    provider,
  );
  if (r.full && ctx.tenant.modules.courses && ctx.tenant.telegramTokenEnc) {
    const { env } = await import("@/config/env");
    const { telegramApi } = await import("@/channels/telegram/api");
    const { telegramChannelInviter } = await import("@/channels/telegram/courses");
    const { revokeChannelsOnRefund } = await import("@/core/courses/channel.server");
    await revokeChannelsOnRefund(
      ctx,
      orderId,
      telegramChannelInviter(telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE)),
      provider,
    );
  }
  return "refunded";
}
