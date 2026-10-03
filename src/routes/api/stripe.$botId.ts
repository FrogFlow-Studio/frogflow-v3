import { createFileRoute } from "@tanstack/react-router";
import { previewWebhookResponse } from "@/lib/preview";

/**
 * Вебхук Stripe (оплата иностранной картой, core/payments/stripe): один адрес
 * на платформу, арендатор — в пути. Подпись Stripe-Signature по телу, секрет
 * вебхука — у продавца. Неверная подпись — 400; верная, но не об оплате
 * сессии Checkout, — 200 без действий (Stripe иначе будет повторять).
 */
export const Route = createFileRoute("/api/stripe/$botId")({
  server: {
    handlers: {
      POST: ({ request, params }) => handle(request, params.botId),
    },
  },
});

async function handle(request: Request, botId: string): Promise<Response> {
  const preview = previewWebhookResponse();
  if (preview) return preview;
  if (!/^[0-9a-f-]{36}$/i.test(botId)) return new Response("not found", { status: 404 });
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const tenant = await resolveTenant({ by: "id", value: botId });
  // Платежи клиента прежней платформы v2 не принимает (servedByV2).
  if (!tenant || tenant.settings.served_by !== "v2")
    return new Response("not found", { status: 404 });
  const ctx = tenantContext(tenant);
  const { stripeFor } = await import("@/core/payments/payment");
  const cfg = await stripeFor(ctx);
  if (!cfg.ready) return new Response("stripe disabled", { status: 403 });

  const raw = await request.text();
  if (raw.length > 256 * 1024) return new Response("too large", { status: 413 });
  const { verifyStripeSignature, stripeOutcome, sessionOrderId } =
    await import("@/core/payments/stripe");
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), cfg.webhookSecret))
    return new Response("bad sign", { status: 400 });
  let ev: import("@/core/payments/stripe").StripeEvent;
  try {
    ev = JSON.parse(raw) as import("@/core/payments/stripe").StripeEvent;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (ev.data?.object?.metadata?.bot_id && ev.data.object.metadata.bot_id !== botId)
    return new Response("ok");
  const orderId = sessionOrderId(ev);
  if (!orderId) return new Response("ok");

  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, orderId);
  if (!order) return new Response("ok");
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const expected = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const outcome = stripeOutcome(ev, { amount: expected, currency: order.currency });
  const s = ev.data?.object;
  const ref = String(s?.payment_intent ?? s?.id ?? "");
  const no = order.display_no ?? order.order_no ?? order.id;

  if (outcome === "mismatch") {
    const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
    await notifyAdminsHtml(
      ctx,
      `⚠️ Платёж Stripe ${ref} не совпал с заказом #${no} по сумме или валюте — заказ не подтверждён. Проверьте кабинет Stripe.`,
      { orderId, kind: "delivery_failure" },
    ).catch((e) => console.error(`[stripe:${botId}] уведомление`, e));
    return new Response("ok");
  }
  if (outcome !== "paid") return new Response("ok");

  const { markPaidOnline } = await import("@/core/payments/payment");
  const r = await markPaidOnline(ctx, orderId, expected, "Stripe", ref);
  if (r.ok && !r.alreadyDone) {
    const { runInBackground } = await import("@/lib/background");
    await runInBackground(async () => {
      try {
        const { afterPaidOnline } = await import("@/app/payments/paid-online.server");
        await afterPaidOnline(ctx, orderId);
      } catch (e) {
        console.error(`[stripe:${botId}] выдача после оплаты`, e);
      }
    }, "stripe.paid");
  }
  return new Response("ok");
}
