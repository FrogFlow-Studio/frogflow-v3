import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";

export function verifyZernioSignature(
  rawBody: string,
  signature: string | null,
  secret: string | undefined,
): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  const received = Buffer.from(signature, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Один вебхук Zernio на всю платформу: проверка подписи здесь, приём —
 * channels/zernio/intake.server (магазин по аккаунту или профилю, строка
 * журнала до ответа, обработка в фоне после ответа 200).
 */
export const Route = createFileRoute("/api/zernio/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const secret = env().ZERNIO_WEBHOOK_SECRET?.trim();
        if (!secret) return new Response("webhook secret is not configured", { status: 503 });
        const sig =
          request.headers.get("x-zernio-signature") || request.headers.get("x-late-signature");
        if (!verifyZernioSignature(raw, sig, secret))
          return new Response("invalid signature", { status: 401 });

        let payload: import("@/channels/zernio/message").ZernioWebhookMessagePayload;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad json", { status: 400 });
        }
        const { intakeZernioEvent, liveIntakeDeps } =
          await import("@/channels/zernio/intake.server");
        const r = await intakeZernioEvent(payload, await liveIntakeDeps());
        return new Response(r.body, { status: r.status });
      },
    },
  },
});
