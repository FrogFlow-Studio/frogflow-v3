import { createFileRoute } from "@tanstack/react-router";

/**
 * Колбэки Robokassa: result (сервер → сервер, подпись pass2), success и
 * fail (браузер покупателя → назад в бота). Один адрес на платформу,
 * арендатор — в пути: /api/robokassa/<bot_id>/result.
 */
export const Route = createFileRoute("/api/robokassa/$botId/$action")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params.botId, params.action),
      POST: ({ request, params }) => handle(request, params.botId, params.action),
    },
  },
});

async function handle(request: Request, botId: string, action: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(botId)) return new Response("not found", { status: 404 });
  const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
  const tenant = await resolveTenant({ by: "id", value: botId });
  if (!tenant) return new Response("not found", { status: 404 });
  const ctx = tenantContext(tenant);
  const params =
    request.method === "POST"
      ? new URLSearchParams(await request.text())
      : new URL(request.url).searchParams;

  if (action === "success" || action === "fail") {
    const username = tenant.settings.telegram?.username;
    const back = username ? `https://t.me/${username}` : ctx.appUrl;
    const ok = action === "success";
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? "Оплата прошла" : "Оплата не прошла"}</title><meta http-equiv="refresh" content="2;url=${back}"><style>body{font-family:system-ui;text-align:center;padding:60px 20px;color:#222}a{color:#0a7}</style></head><body><h1>${ok ? "✅ Оплата прошла" : "❌ Оплата не прошла"}</h1><p>${ok ? "Возвращаемся в бота — материалы придут туда." : "Можно попробовать ещё раз в боте."}</p><p><a href="${back}">Открыть Telegram</a></p></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (action !== "result") return new Response("not found", { status: 404 });

  const outSum = params.get("OutSum");
  const invId = params.get("InvId");
  const signature = params.get("SignatureValue");
  if (!outSum || !invId || !signature) return new Response("bad request", { status: 400 });

  const { robokassaFor, markPaidOnline } = await import("@/core/payments/payment");
  const { verifyResultSignature } = await import("@/core/payments/robokassa");
  const rk = await robokassaFor(ctx);
  if (!rk.ready) return new Response("robokassa disabled", { status: 403 });
  const shp: Array<[string, string]> = [];
  for (const [k, v] of params.entries()) if (k.toLowerCase().startsWith("shp_")) shp.push([k, v]);
  // Пароль выбираем по режиму из настроек, а не по IsTest из запроса: иначе
  // боевой заказ подписывался бы тестовым паролем.
  if (!verifyResultSignature({ outSum, invId, signature, pass2: rk.pass2, shp }))
    return new Response("bad sign", { status: 400 });

  const orderId = Number(invId);
  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, orderId);
  if (!order) return new Response("order not found", { status: 404 });
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const expected = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  if (Math.abs(Number(outSum) - expected) > 0.01) {
    console.error(
      `[robokassa:${botId}] сумма ${outSum} ≠ ожидаемой ${expected} по заказу ${orderId}`,
    );
    return new Response("amount mismatch", { status: 400 });
  }
  const r = await markPaidOnline(ctx, orderId, Number(outSum), "Robokassa");
  if (r.ok && !r.alreadyDone) {
    const { runInBackground } = await import("@/lib/background");
    await runInBackground(async () => {
      try {
        const { env } = await import("@/config/env");
        const { telegramApi } = await import("@/channels/telegram/api");
        const { onOrderPaid } = await import("@/channels/telegram/handle-update");
        if (order.platform === "telegram")
          await onOrderPaid(
            ctx,
            telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE),
            orderId,
          );
      } catch (e) {
        console.error(`[robokassa:${botId}] выдача после оплаты`, e);
      }
    });
  }
  return new Response(`OK${invId}`);
}
