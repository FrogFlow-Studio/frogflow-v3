import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import { verifyTelegramWebhookHeader } from "@/channels/telegram/secret";
import { runInBackground } from "@/lib/background";

/**
 * Один вебхук на всех ботов: /api/telegram/<bot_id>. Подпись — секрет,
 * выведенный из bot_id и WEBHOOK_SECRET (channels/telegram/secret.ts).
 * Fail-closed: без верного заголовка ничего не читаем и не отвечаем 200.
 */
export const Route = createFileRoute("/api/telegram/$botId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const botId = params.botId;
        if (!/^[0-9a-f-]{36}$/i.test(botId)) return new Response("not found", { status: 404 });
        if (
          !verifyTelegramWebhookHeader(
            request.headers.get("x-telegram-bot-api-secret-token"),
            botId,
            env().WEBHOOK_SECRET,
          )
        ) {
          return new Response("forbidden", { status: 403 });
        }
        let update: unknown;
        try {
          update = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
        const tenant = await resolveTenant({ by: "id", value: botId });
        // Клиент ещё на v1: его вебхук не должен быть здесь. Отвечаем 200,
        // чтобы Telegram не копил очередь, и пишем в журнал — это сигнал
        // о неправильно переставленном вебхуке.
        if (!tenant || tenant.settings.served_by !== "v2") {
          console.warn(
            `[telegram] update for ${botId} ignored: tenant ${tenant ? "served by v1" : "not found"}`,
          );
          return new Response("ok");
        }

        const ctx = tenantContext(tenant);
        // Повтор того же update_id (Telegram не дождался ответа) — второго
        // ответа покупателю не будет. Метку ставим до ответа 200 на обеих
        // ветках, иначе повтор успеет проскочить, пока первый идёт в фоне.
        const { claimTelegramUpdate } = await import("@/channels/telegram/dedupe");
        if (!(await claimTelegramUpdate(ctx, (update as { update_id?: number }).update_id)))
          return new Response("ok");

        const run = async () => {
          const { telegramApi } = await import("@/channels/telegram/api");
          const { handleTelegramUpdate } = await import("@/channels/telegram/handle-update");
          await handleTelegramUpdate(
            ctx,
            telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE),
            update as never,
          );
        };

        // Чек и подтверждение продавца могут занять минуты (выдача файлов):
        // отвечаем Telegram сразу, чтобы он не повторил то же обновление.
        const u = update as {
          callback_query?: { data?: string };
          message?: { photo?: unknown; document?: unknown };
        };
        const slow =
          /^(confirm|reject|resend):/.test(u.callback_query?.data ?? "") ||
          Boolean(u.message?.photo || u.message?.document);
        if (slow) {
          await runInBackground(run, "telegram.update");
          return new Response("ok");
        }
        await run();
        return new Response("ok");
      },
    },
  },
});
