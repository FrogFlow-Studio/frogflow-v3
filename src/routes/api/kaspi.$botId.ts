import { createFileRoute } from "@tanstack/react-router";
import { previewWebhookResponse } from "@/lib/preview";

/**
 * Вебхук ApiPay продавца (оплата Kaspi, core/payments/kaspi-apipay): один
 * адрес на платформу, арендатор — в пути. Подпись X-Webhook-Signature по
 * байтам тела, секрет — у продавца. Неверная подпись — 401; верная, но не
 * оплата нашего заказа, — 200 без действий. 5xx — сбой у нас, ApiPay
 * повторит; повтор уже учтённой оплаты второй выдачи не даёт (markPaidOnline
 * пишет условно по статусу заказа).
 */
export const Route = createFileRoute("/api/kaspi/$botId")({
  server: {
    handlers: {
      POST: ({ request, params }) => handle(request, params.botId),
    },
  },
});

const PROVIDER = "Kaspi (ApiPay)";

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
  const { kaspiApipayFor } = await import("@/core/payments/payment");
  const cfg = await kaspiApipayFor(ctx);
  if (!cfg.ready) return new Response("kaspi disabled", { status: 403 });

  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > 64 * 1024) return new Response("too large", { status: 413 });
  const { verifyKaspiSignature, parseKaspiWebhook, kaspiOutcome } =
    await import("@/core/payments/kaspi-apipay");
  if (!verifyKaspiSignature(raw, request.headers.get("x-webhook-signature"), cfg.webhookSecret))
    return new Response("invalid signature", { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const ev = parseKaspiWebhook(payload);
  if (ev.kind === "ignored") return new Response(`ignored: ${ev.reason}`);

  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, ev.orderId);
  if (!order) {
    console.error(`[kaspi:${botId}] событие ApiPay ${ev.apipayId} по неизвестному заказу`);
    return new Response("unknown order");
  }
  const shown = order.display_no ?? order.order_no ?? order.id;

  if (ev.kind === "refunded") {
    const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
    const warn = (text: string) =>
      notifyAdminsHtml(ctx, text, { orderId: order.id, kind: "delivery_failure" }).catch((e) =>
        console.error(`[kaspi:${botId}] уведомление о возврате`, e),
      );
    if (!ev.full) {
      // Частичный возврат: сколько вернули, вебхук не говорит — решает продавец.
      await warn(
        `⚠️ Kaspi (ApiPay): частичный возврат по заказу #${shown} (платёж ${ev.apipayId}). Проверьте сумму в кабинете ApiPay и поправьте оплату заказа.`,
      );
      return new Response("ok");
    }
    const { applyProviderRefund } = await import("@/app/payments/provider-refund.server");
    try {
      const r = await applyProviderRefund(ctx, order.id, PROVIDER, ev.apipayId);
      if (r === "unmatched")
        await warn(
          `⚠️ Kaspi (ApiPay) вернул платёж ${ev.apipayId} по заказу #${shown}, он не засчитан в оплату — проверьте кабинет ApiPay.`,
        );
    } catch (e) {
      console.error(`[kaspi:${botId}] возврат по заказу #${order.id}`, e);
      return new Response("retry later", { status: 500 });
    }
    return new Response("ok");
  }

  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const expected = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const outcome = kaspiOutcome(ev, cfg, { amount: expected, currency: order.currency });
  if (outcome === "sandbox") return new Response("sandbox payment ignored");
  const unapplied = { amount: ev.amount, currency: "KZT", provider: PROVIDER, ref: ev.apipayId };
  if (outcome === "mismatch") {
    // Не та сумма или валюта: заказ не подтверждаем, платёж остаётся в журнале.
    const { reportUnappliedPayment } = await import("@/app/payments/unapplied-payment.server");
    await reportUnappliedPayment(ctx, order, "payment_mismatch", unapplied);
    return new Response("ok");
  }

  const { markPaidOnline } = await import("@/core/payments/payment");
  let r: Awaited<ReturnType<typeof markPaidOnline>>;
  try {
    r = await markPaidOnline(ctx, order.id, expected, PROVIDER, ev.apipayId);
  } catch (e) {
    console.error(`[kaspi:${botId}] оплата заказа #${order.id}`, e);
    return new Response("retry later", { status: 500 });
  }
  if (r.closed) {
    const { reportUnappliedPayment } = await import("@/app/payments/unapplied-payment.server");
    await reportUnappliedPayment(ctx, order, "payment_on_closed", {
      ...unapplied,
      status: r.status,
    });
  }
  if (r.ok && !r.alreadyDone) {
    const { runInBackground } = await import("@/lib/background");
    await runInBackground(async () => {
      try {
        const { afterPaidOnline } = await import("@/app/payments/paid-online.server");
        await afterPaidOnline(ctx, order.id);
      } catch (e) {
        console.error(`[kaspi:${botId}] выдача после оплаты`, e);
      }
    }, "kaspi.paid");
  }
  return new Response("ok");
}
