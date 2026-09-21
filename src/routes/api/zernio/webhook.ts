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
 * zernio_logs с уникальным индексом: доставка у Zernio at-least-once, и
 * повтор события (в том числе по таймауту ответа) не должен обернуться
 * вторым ответом покупателю. Строка журнала заводится до обработки и
 * получает итог после: processed / ignored / failed с причиной.
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
        const accountId =
          payload.account?.accountId || payload.account?.id || payload.account?._id || null;
        const eventId = payload.id ?? null;
        if (!accountId || !eventId) return new Response("accepted", { status: 202 });

        const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
        const tenant = await resolveTenant({ by: "zernio_account", value: accountId });
        if (!tenant || tenant.settings.served_by !== "v2")
          return new Response("accepted", { status: 202 });
        const ctx = tenantContext(tenant);

        const handled =
          payload.event === "message.received" ||
          payload.event === "account.disconnected" ||
          payload.event === "whatsapp.template.status_updated";
        const { error } = await ctx.db.from("zernio_logs").insert({
          bot_id: tenant.id,
          event_id: eventId,
          event_type: payload.event ?? "unknown",
          status: handled ? "received" : "ignored",
          payload: payload as never,
          error_message: handled ? null : "v2: событие не обрабатывается",
        });
        if (error) {
          // Конфликт по event_id — повторная доставка, уже принято.
          if (/duplicate|unique/i.test(error.message)) return new Response("ok");
          return new Response("error", { status: 500 });
        }
        if (!handled) return new Response("ok");

        const { runWithZernioEvent } = await import("@/channels/zernio/event-context.server");
        let status = "failed";
        let note: string | null = null;
        try {
          if (payload.event === "whatsapp.template.status_updated") {
            const { handleTemplateStatus } = await import("@/channels/zernio/templates.server");
            const r = await handleTemplateStatus(
              ctx,
              payload as import("@/channels/zernio/templates.server").TemplateStatusPayload,
            );
            status = "processed";
            note = r.note;
          } else if (payload.event === "account.disconnected") {
            const { handleAccountDisconnected } = await import("@/channels/zernio/handle-account");
            const r = await handleAccountDisconnected(ctx, payload);
            status = "processed";
            note = r.note;
          } else {
            const { handleZernioMessage } = await import("@/channels/zernio/handle-message");
            const r = await runWithZernioEvent(eventId, () => handleZernioMessage(ctx, payload));
            status = r.status;
            note = r.note ?? null;
          }
        } catch (e) {
          note = e instanceof Error ? e.message : String(e);
          console.error(`[zernio] ${eventId} failed: ${note}`);
        }
        await ctx.db
          .from("zernio_logs")
          .update({ status, error_message: note })
          .eq("event_id", eventId);
        return new Response("ok");
      },
    },
  },
});
