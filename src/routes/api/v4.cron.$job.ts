import { withNoStore } from "@/app/cache-policy";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { previewWebhookResponse } from "@/lib/preview";
import { reportError } from "@/lib/errors";
import { isV4CronJob } from "@/v4/jobs/cron.server";

/**
 * Крон v4: /api/v4/cron/tick | jobs | notify-now | notify-digest. Только
 * магазины с served_by = "v4" (app/v4/cron.server). В расписании не стоит:
 * включается в день первого переезда.
 */
export const Route = createFileRoute("/api/v4/cron/$job")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isCronAuthorized(request, env().CRON_SECRET))
          return withNoStore(new Response("unauthorized", { status: 401 }));
        const preview = previewWebhookResponse();
        if (preview) return preview;
        if (!isV4CronJob(params.job))
          return withNoStore(new Response("not found", { status: 404 }));
        try {
          const { runV4CronJob } = await import("@/app/v4/cron.server");
          const results = await runV4CronJob(params.job);
          return withNoStore(Response.json({ job: `v4:${params.job}`, results }));
        } catch (e) {
          await reportError(e, { where: `cron:v4:${params.job}` });
          return withNoStore(new Response("error", { status: 500 }));
        }
      },
    },
  },
});
