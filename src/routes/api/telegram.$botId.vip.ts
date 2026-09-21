import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import { timingSafeSecretEqual } from "@/channels/telegram/secret";
import { runInBackground } from "@/lib/background";

/**
 * Вебхук VIP-бота клиента: /api/telegram/<bot_id>/vip. Секрет свой (см.
 * core/tenant/vip-webhook.server.ts), fail-closed как у основного бота.
 */
export const Route = createFileRoute("/api/telegram/$botId/vip")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const botId = params.botId;
        if (!/^[0-9a-f-]{36}$/i.test(botId)) return new Response("not found", { status: 404 });
        const { vipWebhookSecret } = await import("@/core/tenant/vip-webhook.server");
        const header = request.headers.get("x-telegram-bot-api-secret-token");
        if (
          !header ||
          !timingSafeSecretEqual(header, vipWebhookSecret(botId, env().WEBHOOK_SECRET))
        )
          return new Response("forbidden", { status: 403 });
        let update: unknown;
        try {
          update = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }
        const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
        const tenant = await resolveTenant({ by: "id", value: botId });
        if (
          !tenant ||
          tenant.settings.served_by !== "v2" ||
          !tenant.modules.vip ||
          !tenant.settings.vip?.token_enc
        )
          return new Response("ok");
        const run = async () => {
          const { handleVipUpdate, vipTelegramApi } =
            await import("@/channels/telegram/vip/handle");
          const ctx = tenantContext(tenant);
          await handleVipUpdate(ctx, vipTelegramApi(ctx), update as never);
        };
        const u = update as {
          message?: { photo?: unknown; document?: unknown };
          callback_query?: { data?: string };
        };
        const slow =
          Boolean(u.message?.photo || u.message?.document) ||
          /^vip_(confirm|reject):/.test(u.callback_query?.data ?? "");
        if (slow) {
          await runInBackground(run);
          return new Response("ok");
        }
        await run();
        return new Response("ok");
      },
    },
  },
});
