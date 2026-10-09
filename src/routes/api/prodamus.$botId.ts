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

async function handle(request: Request, rawBotId: string): Promise<Response> {
  const preview = previewWebhookResponse();
  if (preview) return preview;
  // Адрес уведомления продавец вставляет в кабинет Продамуса руками: точка или
  // пробел в конце (Копилка русоведа 09.10, «…511431.») давали 404 на каждую оплату.
  const botId = prodamusBotId(rawBotId);
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
  // Каждое уведомление — в журнал клиента: без него «оплатили, а заказ ждёт
  // оплаты» не разобрать (Копилка русоведа 09.10, заказы №16 и №17).
  const trace = (outcome: string, extra: Record<string, unknown> = {}) =>
    traceProdamus(botId, n, outcome, extra);
  if (!verifyProdamusSign(n, request.headers.get("sign"), cfg.secretKey)) {
    await trace("bad_sign", { has_sign: Boolean(request.headers.get("sign")) });
    return new Response("bad sign", { status: 400 });
  }
  // order_num — наш chargeRef: заказ и выставленная сумма под нашей подписью.
  // Чужой формат (оплата не из FrogFlow) или подделка — не наш платёж.
  const charge = parseChargeRef(cfg, n.order_num);
  if (!charge) {
    await trace("not_our_order");
    return new Response("success");
  }
  const orderId = charge.orderId;

  const { getOrder } = await import("@/core/orders/orders");
  const order = await getOrder(ctx, orderId);
  if (!order) {
    await trace("order_not_found", { order: orderId });
    return new Response("success");
  }
  const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
  const expected = await amountDueNow(ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const outcome = prodamusOutcome(n, charge);
  if (outcome === "ignore") {
    await trace("not_success", { order: orderId });
    return new Response("success");
  }
  // Заказ в тенге оплачен рублями: в журнале — и номер платежа, и списанная сумма.
  const converted = charge.currency !== order.currency.toUpperCase();
  const ref = `${String(n.order_id ?? "")}${converted ? `, ${charge.amount} ${charge.currency}` : ""}`;

  const unapplied = { currency: order.currency, provider: "Продамус", ref };
  if (outcome === "mismatch") {
    await trace("mismatch", { order: orderId, expected: charge.amount });
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
  await trace(r.ok ? (r.alreadyDone ? "already_done" : "paid") : "order_not_found", {
    order: orderId,
    ...(r.closed ? { closed: r.status } : {}),
  });
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

/** id клиента из адреса без хвоста из точек, пробелов и слэшей, как вставили в кабинете. */
export function prodamusBotId(raw: string): string {
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // не адрес — проверка ниже ответит 404
  }
  return id.trim().replace(/[.\s/]+$/, "");
}

/** Уведомление Продамуса в журнал клиента (bot_events, payment): поля без ключей и подписи. */
async function traceProdamus(
  botId: string,
  n: Record<string, unknown>,
  outcome: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const field = (k: string) => String(n[k] ?? "").slice(0, 80);
  try {
    const { logEvent } = await import("@/app/operator/client-log.server");
    await logEvent(
      botId,
      "payment",
      {
        provider: "prodamus",
        outcome,
        order_num: field("order_num"),
        order_id: field("order_id"),
        sum: field("sum"),
        currency: field("currency"),
        payment_status: field("payment_status"),
        ...extra,
      },
      "prodamus",
    );
  } catch (e) {
    console.warn(`[prodamus:${botId}] журнал не записан`, e);
  }
  if (outcome !== "paid" && outcome !== "already_done")
    console.warn(`[prodamus:${botId}] уведомление: ${outcome}`);
}
