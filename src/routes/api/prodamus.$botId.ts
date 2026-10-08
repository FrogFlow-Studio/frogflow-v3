import { withNoStore } from "@/app/cache-policy";
import { createFileRoute } from "@tanstack/react-router";
import { previewWebhookResponse } from "@/lib/preview";

/**
 * Уведомление Продамуса об оплате (core/payments/prodamus): один адрес на
 * платформу, арендатор — в пути (ссылка передаёт его в urlNotification).
 * Подпись — заголовок Sign по телу, ключ у продавца. Неверная подпись — 400;
 * верная, но не успешная оплата нашего заказа, — 200 без действий (Продамус
 * иначе будет повторять).
 */
export const Route = createFileRoute("/api/prodamus/$botId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => withNoStore(await handle(request, params.botId)),
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
  const { prodamusFor } = await import("@/core/payments/payment");
  const cfg = await prodamusFor(ctx);
  if (!cfg.ready) return new Response("prodamus disabled", { status: 403 });

  const raw = await request.text();
  if (raw.length > 256 * 1024) return new Response("too large", { status: 413 });
  const { parsePhpForm, verifyProdamusSign, prodamusOutcome, parseChargeRef } =
    await import("@/core/payments/prodamus");
  let n: Record<string, unknown>;
  try {
    n = (request.headers.get("content-type") ?? "").includes("json")
      ? (JSON.parse(raw) as Record<string, unknown>)
      : parsePhpForm(raw);
  } catch {
    return new Response("bad body", { status: 400 });
  }
  if (!verifyProdamusSign(n, request.headers.get("sign"), cfg.secretKey))
    return new Response("bad sign", { status: 400 });
  // order_num — наш chargeRef: заказ и выставленная сумма под нашей подписью.
  // Чужой формат (оплата не из FrogFlow) или подделка — не наш платёж.
  const charge = parseChargeRef(cfg, n.order_num);
  if (!charge) return new Response("success");
  const orderId = charge.orderId;

  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, orderId);
  if (!order) return new Response("success");
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const expected = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const outcome = prodamusOutcome(n, charge);
  if (outcome === "ignore") return new Response("success");
  // Заказ в тенге оплачен рублями: в журнале — и номер платежа, и списанная сумма.
  const converted = charge.currency !== order.currency.toUpperCase();
  const ref = `${String(n.order_id ?? "")}${converted ? `, ${charge.amount} ${charge.currency}` : ""}`;

  const unapplied = { currency: order.currency, provider: "Продамус", ref };
  if (outcome === "mismatch") {
    // Деньги пришли не на ту сумму или в той валюте: пишем то, что списал Продамус.
    const { reportUnappliedPayment } = await import("@/app/payments/unapplied-payment.server");
    await reportUnappliedPayment(ctx, order, "payment_mismatch", {
      ...unapplied,
      currency: String(n.currency ?? charge.currency).toUpperCase(),
      amount: Number(String(n.sum ?? "0").replace(",", ".")) || 0,
    });
    return new Response("success");
  }

  const { markPaidOnline } = await import("@/core/payments/payment");
  const r = await markPaidOnline(ctx, orderId, expected, "Продамус", ref);
  if (r.closed) {
    const { reportUnappliedPayment } = await import("@/app/payments/unapplied-payment.server");
    await reportUnappliedPayment(ctx, order, "payment_on_closed", {
      ...unapplied,
      amount: expected,
      status: r.status,
    });
  }
  if (r.ok && !r.alreadyDone) {
    const { runInBackground } = await import("@/lib/background");
    await runInBackground(async () => {
      try {
        const { afterPaidOnline } = await import("@/app/payments/paid-online.server");
        await afterPaidOnline(ctx, orderId);
      } catch (e) {
        console.error(`[prodamus:${botId}] выдача после оплаты`, e);
      }
    }, "prodamus.paid");
  }
  return new Response("success");
}
