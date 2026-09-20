import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Кроны одного деплоя обходят всех арендаторов. Каждая задача — функция
 * от Tenant; сбой у одного клиента не останавливает остальных.
 */
export const Route = createFileRoute("/api/cron/$job")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isCronAuthorized(request, env().CRON_SECRET))
          return new Response("unauthorized", { status: 401 });
        const { tenantDirectory } = await import("@/core/tenant/resolve.server");
        const tenants = (await tenantDirectory(true)).filter((t) => t.settings.served_by === "v2");
        const results: Record<string, unknown> = {};

        switch (params.job) {
          case "ensure-webhook": {
            const { ensureTelegramWebhook } = await import("@/core/tenant/telegram-webhook.server");
            for (const t of tenants) {
              try {
                results[t.id] = await ensureTelegramWebhook(t);
              } catch (e) {
                results[t.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
              }
            }
            break;
          }
          default:
            return new Response("unknown job", { status: 404 });
        }
        return Response.json({ job: params.job, tenants: tenants.length, results });
      },
    },
  },
});
