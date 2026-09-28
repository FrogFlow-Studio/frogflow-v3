import { createFileRoute } from "@tanstack/react-router";

/**
 * IPN NOWPayments (оплата криптой, core/payments/nowpayments): один адрес на
 * платформу, арендатор — в пути. Подпись x-nowpayments-sig по телу, секрет
 * IPN — у продавца. Неверная подпись — 400; верная, но не «finished», —
 * 200 без действий (NOWPayments пришлёт следующий статус сам).
 */
export const Route = createFileRoute("/api/nowpayments/$botId")({
  server: {
    handlers: {
      POST: ({ request, params }) => handle(request, params.botId),
    },
  },
});

async function handle(request: Request, botId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(botId)) return new Response("not found", { status: 404 });
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const tenant = await resolveTenant({ by: "id", value: botId });
  // Платежи клиента прежней платформы v2 не принимает (servedByV2).
  if (!tenant || tenant.settings.served_by !== "v2")
    return new Response("not found", { status: 404 });
  const ctx = tenantContext(tenant);
  const { nowpaymentsFor } = await import("@/core/payments/payment");
  const cfg = await nowpaymentsFor(ctx);
  if (!cfg.ready) return new Response("crypto disabled", { status: 403 });

  const raw = await request.text();
  if (raw.length > 64 * 1024) return new Response("too large", { status: 413 });
  const { verifyIpn, ipnOutcome } = await import("@/core/payments/nowpayments");
  if (!verifyIpn(raw, request.headers.get("x-nowpayments-sig"), cfg.ipnSecret))
    return new Response("bad sign", { status: 400 });
  const ipn = JSON.parse(raw) as import("@/core/payments/nowpayments").Ipn;
  const orderId = Number(ipn.order_id);
  if (!Number.isInteger(orderId) || orderId <= 0) return new Response("bad order", { status: 400 });

  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, orderId);
  if (!order) return new Response("order not found", { status: 404 });
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const expected = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const outcome = ipnOutcome(ipn, { amount: expected, currency: order.currency });
  const ref = String(ipn.payment_id ?? ipn.invoice_id ?? "");
  const no = order.display_no ?? order.order_no ?? order.id;

  if (outcome === "partial" || outcome === "mismatch") {
    const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
    await notifyAdminsHtml(
      ctx,
      outcome === "partial"
        ? `⚠️ По заказу #${no} криптой оплачено не полностью (NOWPayments, платёж ${ref}). Проверьте кабинет NOWPayments и свяжитесь с покупателем.`
        : `⚠️ Платёж NOWPayments ${ref} не совпал с заказом #${no} по сумме или валюте — заказ не подтверждён. Проверьте кабинет NOWPayments.`,
      { orderId, kind: "delivery_failure" },
    ).catch((e) => console.error(`[nowpayments:${botId}] уведомление`, e));
    return new Response("ok");
  }
  if (outcome !== "paid") return new Response("ok");

  const { markPaidOnline } = await import("@/core/payments/payment");
  const r = await markPaidOnline(ctx, orderId, expected, "NOWPayments", ref);
  if (r.ok && !r.alreadyDone) {
    const { runInBackground } = await import("@/lib/background");
    await runInBackground(async () => {
      try {
        const { afterPaidOnline } = await import("@/app/payments/paid-online.server");
        await afterPaidOnline(ctx, orderId);
      } catch (e) {
        console.error(`[nowpayments:${botId}] выдача после оплаты`, e);
      }
    }, "nowpayments.paid");
  }
  return new Response("ok");
}
