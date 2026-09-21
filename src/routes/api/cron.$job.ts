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
            // VIP-боты: второй токен у клиентов с модулем.
            const { ensureVipWebhook } = await import("@/core/tenant/vip-webhook.server");
            for (const t of tenants) {
              if (!t.modules.vip || !t.settings.vip?.token_enc) continue;
              try {
                results[`${t.id}:vip`] = await ensureVipWebhook(t);
              } catch (e) {
                results[`${t.id}:vip`] = {
                  ok: false,
                  error: e instanceof Error ? e.message : String(e),
                };
              }
            }
            // Zernio: один вебхук на платформу, а не на клиента — и только когда
            // хоть один клиент v2 подключил Instagram/WhatsApp: иначе платформе
            // нечего слушать, а ключ может быть общим с деплоем v1.
            const zernioInUse = tenants.some(
              (t) => t.settings.zernio?.profile_id || t.settings.zernio?.account_ids?.length,
            );
            if (zernioInUse) {
              const { ensurePlatformWebhook } = await import("@/channels/zernio/connect.server");
              results.zernio = await ensurePlatformWebhook();
            } else
              results.zernio = { ok: true, action: "skipped", error: "нет клиентов v2 с Zernio" };
            break;
          }
          case "broadcast":
          case "cart-reminder":
          case "fulfillment-reminder": {
            const jobs = await import("@/channels/telegram/jobs");
            const wa = await import("@/channels/zernio/jobs");
            const run = {
              // Рассылки: пакет Telegram и пакет WhatsApp (шаблоны Meta) — по одному на клиента.
              broadcast: async (t: (typeof tenants)[number]) => ({
                telegram: await jobs.runBroadcastBatch(t),
                whatsapp: await wa.runWhatsAppBroadcastBatch(t),
              }),
              "cart-reminder": jobs.runCartReminders,
              "fulfillment-reminder": jobs.runFulfillmentReminders,
            }[params.job];
            // Клиенты — параллельно: пакет рассылки одного не задерживает других.
            const settled = await Promise.allSettled(tenants.map((t) => run(t)));
            settled.forEach((r, i) => {
              const id = tenants[i]!.id;
              results[id] =
                r.status === "fulfilled"
                  ? r.value
                  : {
                      ok: false,
                      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
                    };
            });
            break;
          }
          case "vip": {
            // Напоминания об истечении и исключение из VIP-групп.
            const { runVipCron } = await import("@/core/vip/cron");
            const { tenantContext } = await import("@/core/tenant/resolve.server");
            const { vipGroupApi } = await import("@/channels/telegram/vip/group");
            const { vipTelegramApi } = await import("@/channels/telegram/vip/handle");
            for (const t of tenants) {
              if (!t.modules.vip || !t.settings.vip?.token_enc) continue;
              try {
                const ctx = tenantContext(t);
                const api = vipTelegramApi(ctx);
                results[t.id] = await runVipCron(
                  ctx,
                  vipGroupApi(api),
                  t.settings.vip.username ?? null,
                );
              } catch (e) {
                results[t.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
              }
            }
            break;
          }
          case "comment-dm-fallback": {
            // Резервная DM по комментариям Instagram, если родное правило Zernio замолчало.
            const { runCommentDmFallback } = await import("@/channels/zernio/automations.server");
            const { tenantContext } = await import("@/core/tenant/resolve.server");
            for (const t of tenants) {
              if (!t.modules.instagram || !t.settings.zernio?.profile_id) continue;
              try {
                results[t.id] = await runCommentDmFallback(tenantContext(t));
              } catch (e) {
                results[t.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
              }
            }
            break;
          }
          case "health": {
            // Снимок здоровья каждого бота на v2 — история простоев в панели оператора.
            const { recordHealthSnapshots } = await import("@/app/operator/health.server");
            results.health = await recordHealthSnapshots();
            break;
          }
          case "subscriptions": {
            // Подписки клиентов на платформу: предупредить, приостановить по политике.
            const { sweepSubscriptions } = await import("@/app/operator/billing.server");
            results.subscriptions = await sweepSubscriptions();
            break;
          }
          case "retention": {
            // Один проход на всех клиентов: журналы, переписка, попытки входа.
            const { runRetention } = await import("@/core/retention/retention");
            results.retention = await runRetention();
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
