import { createFileRoute } from "@tanstack/react-router";
import { previewWebhookResponse } from "@/lib/preview";
import { env } from "@/config/env";

/**
 * Вебхук ApiPay на всю платформу: оплаты счетов платформы по ссылке ApiPay
 * (core/billing/pay/apipay.ts). Адрес <APP_URL>/api/apipay/webhook
 * добавляется в кабинете ApiPay → Настройки → Подключение, секрет оттуда —
 * в APIPAY_WEBHOOK_SECRET.
 */
export const Route = createFileRoute("/api/apipay/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const preview = previewWebhookResponse();
        if (preview) return preview;
        // Подпись — по байтам тела как пришли, без перекодирования в строку.
        const raw = Buffer.from(await request.arrayBuffer());
        const secret = env().APIPAY_WEBHOOK_SECRET?.trim();
        if (!secret) return new Response("webhook secret is not configured", { status: 503 });
        const { verifyApipaySignature, parseApipayWebhook } =
          await import("@/core/billing/pay/apipay");
        if (!verifyApipaySignature(raw, request.headers.get("x-webhook-signature"), secret))
          return new Response("invalid signature", { status: 401 });
        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch {
          return new Response("bad json", { status: 400 });
        }
        const { settleApipayEvent, liveSettleDeps } = await import("@/app/operator/apipay.server");
        try {
          const r = await settleApipayEvent(parseApipayWebhook(payload), await liveSettleDeps());
          return new Response(r.body, { status: r.status });
        } catch (e) {
          const { reportError } = await import("@/lib/errors");
          await reportError(e, { where: "apipay-webhook" });
          return new Response("retry later", { status: 500 });
        }
      },
    },
  },
});
