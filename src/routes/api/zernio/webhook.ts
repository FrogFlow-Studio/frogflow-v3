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
 * Один вебхук Zernio на всю платформу. Арендатор — по accountId события
 * (bots.settings.zernio.account_ids). Дедупликация — вставкой event_id в
 * zernio_logs с уникальным индексом: доставка у Zernio at-least-once.
 *
 * Обработка сообщений Instagram/WhatsApp (магазин в Direct, консультант)
 * переносится в фазе 4 (docs/ROADMAP.md); до неё события принимаются,
 * пишутся в журнал как ignored и не теряются.
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

        let payload: {
          event?: string;
          id?: string;
          account?: { accountId?: string; id?: string; _id?: string };
          message?: { accountId?: string };
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad json", { status: 400 });
        }
        const accountId =
          payload.account?.accountId ||
          payload.account?.id ||
          payload.account?._id ||
          payload.message?.accountId ||
          null;
        const eventId = payload.id ?? null;
        if (!accountId || !eventId) return new Response("accepted", { status: 202 });

        const { resolveTenant } = await import("@/core/tenant/resolve.server");
        const tenant = await resolveTenant({ by: "zernio_account", value: accountId });
        if (!tenant || tenant.settings.served_by !== "v2")
          return new Response("accepted", { status: 202 });

        const { tenantDb } = await import("@/core/db/client.server");
        const { error } = await tenantDb(tenant.id)
          .from("zernio_logs")
          .insert({
            bot_id: tenant.id,
            event_id: eventId,
            event_type: payload.event ?? "unknown",
            status: "ignored",
            payload: payload as never,
            error_message: "v2: обработчик канала ещё не перенесён",
          });
        // Конфликт по event_id — повторная доставка, уже принято.
        if (error && !/duplicate|unique/i.test(error.message))
          return new Response("error", { status: 500 });
        return new Response("ok");
      },
    },
  },
});
