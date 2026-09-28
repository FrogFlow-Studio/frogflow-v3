import { createFileRoute } from "@tanstack/react-router";

/**
 * Колбэки Robokassa: result (сервер → сервер, подпись pass2), success и
 * fail (браузер покупателя → назад в бота или на страницу заказа с сайта). Один адрес на платформу,
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
  // Платежи клиента прежней платформы подтверждает она сама (см. servedByV2).
  if (!tenant || tenant.settings.served_by !== "v2")
    return new Response("not found", { status: 404 });
  const ctx = tenantContext(tenant);
  const params =
    request.method === "POST"
      ? new URLSearchParams(await request.text())
      : new URL(request.url).searchParams;

  if (action === "success" || action === "fail") {
    const web = await webOrderReturn(ctx, params, action === "success");
    if (web) return Response.redirect(web, 302);
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

  const { parseRobokassaInvId } = await import("@/core/orders/balance");
  const inv = parseRobokassaInvId(invId);
  if (!inv) return new Response("bad request", { status: 400 });
  if (inv.balance) return balanceResult(ctx, inv.orderId, outSum, invId, rk.region ?? "kz");
  const orderId = inv.orderId;
  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, orderId);
  if (!order) return new Response("order not found", { status: 404 });
  // Касса списывает в своей валюте (Казахстан — тенге, Россия — рубли):
  // платёж по заказу в другой валюте — не оплата его суммы.
  const { robokassaAccepts } = await import("@/core/payments/robokassa");
  if (!robokassaAccepts(order.currency, rk.region)) {
    console.error(`[robokassa:${botId}] заказ ${orderId} в ${order.currency}, не в валюте кассы`);
    return new Response("currency mismatch", { status: 400 });
  }
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const expected = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  // «не число» (NaN) проходило сравнение: NaN > 0.01 — ложь, и в paid_amount ложился NaN.
  const paid = Number(outSum);
  if (!Number.isFinite(paid) || Math.abs(paid - expected) > 0.01) {
    console.error(
      `[robokassa:${botId}] сумма ${outSum} ≠ ожидаемой ${expected} по заказу ${orderId}`,
    );
    return new Response("amount mismatch", { status: 400 });
  }
  const r = await markPaidOnline(ctx, orderId, paid, "Robokassa", invId);
  if (r.ok && r.alreadyDone && ["cancelled", "rejected"].includes(order.status)) {
    // Покупатель заплатил по ссылке, открытой до отмены (отклонения) неоплаченного заказа
    // с сайта: деньги пришли, заказ закрыт — решает продавец.
    const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
    await notifyAdminsHtml(
      ctx,
      `⚠️ Оплата ${paid} через Robokassa пришла по отклонённому заказу #${order.display_no ?? order.order_no}. Свяжитесь с покупателем: выдать заказ или вернуть деньги.`,
      { orderId, kind: "delivery_failure" },
    ).catch((e) => console.error(`[robokassa:${botId}] уведомление`, e));
  }
  if (r.ok && !r.alreadyDone) {
    const { runInBackground } = await import("@/lib/background");
    await runInBackground(async () => {
      try {
        const { afterPaidOnline } = await import("@/app/payments/paid-online.server");
        await afterPaidOnline(ctx, orderId);
      } catch (e) {
        console.error(`[robokassa:${botId}] выдача после оплаты`, e);
      }
    });
  }
  return new Response(`OK${invId}`);
}

/**
 * Остаток по задатку оплачен картой (InvId остатка, core/orders/balance).
 * Сумма не сверяется с «к оплате сейчас»: деньги уже пришли с верной
 * подписью; записываем их, если не выходит переплаты, иначе — продавцу.
 */
async function balanceResult(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  orderId: number,
  outSum: string,
  invId: string,
  region: import("@/core/payments/robokassa").RobokassaRegion,
): Promise<Response> {
  const paid = Number(outSum);
  if (!Number.isFinite(paid) || paid <= 0) {
    console.error(`[robokassa:${ctx.tenant.id}] остаток: сумма ${outSum} по заказу ${orderId}`);
    return new Response("amount mismatch", { status: 400 });
  }
  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, orderId);
  if (!order) return new Response("order not found", { status: 404 });
  const { robokassaAccepts } = await import("@/core/payments/robokassa");
  if (!robokassaAccepts(order.currency, region)) {
    console.error(`[robokassa:${ctx.tenant.id}] остаток: заказ ${orderId} в ${order.currency}`);
    return new Response("currency mismatch", { status: 400 });
  }
  const { recordBalancePaidOnline } = await import("@/core/orders/balance");
  const { result: r, proofPending } = await recordBalancePaidOnline(
    ctx,
    orderId,
    paid,
    "Robokassa",
    invId,
  );
  if (r === "not_found") return new Response("order not found", { status: 404 });
  if (r === "retry") return new Response("retry", { status: 500 });
  if (r === "recorded" || r === "refused" || r === "closed") {
    const { formatMoney } = await import("@/core/money/money");
    const { escapeHtml } = await import("@/channels/telegram/copy");
    const no = order.display_no ?? order.order_no;
    const sum = escapeHtml(formatMoney(paid, order.currency));
    const inv = ` (счёт Robokassa №${escapeHtml(invId)})`;
    const text =
      r === "recorded"
        ? `💳 Остаток ${sum} по заказу #${no} оплачен картой через Robokassa${inv}.`
        : r === "closed"
          ? `⚠️ Оплата остатка ${sum} через Robokassa${inv} пришла по отменённому заказу #${no}. Свяжитесь с покупателем: выполнить заказ или вернуть деньги.`
          : `⚠️ Оплата ${sum} через Robokassa${inv} пришла по заказу #${no}, но остаток уже внесён. Свяжитесь с покупателем и верните разницу.`;
    const proofNote = proofPending
      ? "\nПо заказу ждёт чек на остаток: остаток уже оплачен картой. Если перевод по чеку тоже пришёл — верните его, в заказ не вносите."
      : "";
    const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
    await notifyAdminsHtml(ctx, text + proofNote, {
      orderId,
      kind: r === "recorded" ? "fulfillment" : "delivery_failure",
    }).catch((e) => console.error(`[robokassa:${ctx.tenant.id}] уведомление об остатке`, e));
    if (r === "recorded") {
      const { notifyBalancePaid } = await import("@/app/admin/balance.server");
      await notifyBalancePaid(ctx, orderId, paid).catch((e) =>
        console.error(`[robokassa:${ctx.tenant.id}] покупателю об остатке`, e),
      );
    }
  }
  return new Response(`OK${invId}`);
}

/**
 * Покупатель заказа с сайта возвращается на страницу заказа. После успеха —
 * с подписанной ссылкой, но только если подпись Robokassa (пароль №1) верна;
 * после отказа подписи нет, поэтому — без ссылки: страница возьмёт её из
 * браузера, где покупатель оформлял заказ.
 */
async function webOrderReturn(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  params: URLSearchParams,
  success: boolean,
): Promise<string | null> {
  const invId = params.get("InvId") ?? "";
  const slug = ctx.tenant.settings.slug;
  const { parseRobokassaInvId } = await import("@/core/orders/balance");
  const inv = parseRobokassaInvId(invId);
  if (!inv || !slug) return null;
  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, inv.orderId);
  const { hasOrderPage } = await import("@/core/storefront/web-order");
  if (!order || !(await hasOrderPage(ctx, order))) return null;
  const page = `${ctx.appUrl}/s/${encodeURIComponent(slug)}/order/${order.id}`;
  if (!success) return page;
  const { robokassaFor } = await import("@/core/payments/payment");
  const { verifySuccessSignature } = await import("@/core/payments/robokassa");
  const rk = await robokassaFor(ctx);
  const outSum = params.get("OutSum");
  const signature = params.get("SignatureValue");
  if (!rk.ready || !outSum || !signature) return page;
  const shp: Array<[string, string]> = [];
  for (const [k, v] of params.entries()) if (k.toLowerCase().startsWith("shp_")) shp.push([k, v]);
  if (!verifySuccessSignature({ outSum, invId, signature, pass1: rk.pass1, shp })) return page;
  const { env } = await import("@/config/env");
  const { orderAccessToken } = await import("@/core/storefront/web-order");
  return `${page}?t=${orderAccessToken(env().SESSION_SECRET, ctx.tenant.id, order.id)}`;
}
