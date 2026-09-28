import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import { timingSafeSecretEqual } from "@/channels/telegram/secret";
import { runInBackground } from "@/lib/background";

/**
 * Вебхук VIP-бота клиента: /api/telegram/<bot_id>/vip. Секрет свой (см.
 * channels/telegram/vip-webhook-setup.server.ts), fail-closed как у основного бота.
 */
export const Route = createFileRoute("/api/telegram/$botId/vip")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const botId = params.botId;
        if (!/^[0-9a-f-]{36}$/i.test(botId)) return new Response("not found", { status: 404 });
        const { vipWebhookSecret } = await import("@/channels/telegram/vip-webhook-setup.server");
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
        const ctx = tenantContext(tenant);
        // Повтор обновления VIP-бота — без второго ответа (channels/telegram/dedupe.ts).
        const { claimTelegramUpdate } = await import("@/channels/telegram/dedupe");
        if (!(await claimTelegramUpdate(ctx, (update as { update_id?: number }).update_id, "vip")))
          return new Response("ok");
        // Вход в группу: вошедшего по чужой ссылке подписки выгоняем (core/vip/join-guard).
        const chatMember = (update as { chat_member?: unknown }).chat_member;
        if (chatMember) {
          await runInBackground(async () => {
            const [{ guardVipJoin }, { vipGroupApi }, { vipTelegramApi }, { notifyAdminsHtml }] =
              await Promise.all([
                import("@/core/vip/join-guard"),
                import("@/channels/telegram/vip/group"),
                import("@/channels/telegram/vip/handle"),
                import("@/channels/telegram/notify"),
              ]);
            await guardVipJoin(ctx, vipGroupApi(vipTelegramApi(ctx)), chatMember as never, (html) =>
              notifyAdminsHtml(ctx, html, { kind: "system" }).then(() => undefined),
            );
          }, "telegram.vip.join");
          return new Response("ok");
        }
        const run = async () => {
          const { handleVipUpdate, vipTelegramApi } =
            await import("@/channels/telegram/vip/handle");
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
          await runInBackground(run, "telegram.vip");
          return new Response("ok");
        }
        await run();
        return new Response("ok");
      },
    },
  },
});
