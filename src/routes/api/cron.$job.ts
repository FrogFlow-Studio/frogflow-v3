import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { reportError } from "@/lib/errors";

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
        const startedAt = Date.now();
        const { recordCronRun, summarizeResults } =
          await import("@/app/operator/cron-status.server");
        const finish = async (ok: boolean, error: string | null) => {
          await recordCronRun(params.job, {
            at: new Date().toISOString(),
            ok,
            durationMs: Date.now() - startedAt,
            tenants: tenants.length,
            summary: summarizeResults(results),
            error,
          }).catch(() => undefined);
        };
        // Сбой у одного клиента — в итог крона и в учёт ошибок, остальные идут дальше.
        const tenantFailure = async (botId: string, e: unknown) => {
          await reportError(e, { where: `cron:${params.job}`, botId });
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        };
        try {
          const r = await runJob();
          if (r) return r;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await finish(false, msg);
          await reportError(e, { where: `cron:${params.job}` });
          return new Response("error", { status: 500 });
        }
        await finish(true, null);
        return Response.json({ job: params.job, tenants: tenants.length, results });

        async function runJob(): Promise<Response | null> {
          switch (params.job) {
            case "ensure-webhook": {
              const { ensureTelegramWebhook } =
                await import("@/core/tenant/telegram-webhook.server");
              for (const t of tenants) {
                try {
                  results[t.id] = await ensureTelegramWebhook(t);
                } catch (e) {
                  results[t.id] = await tenantFailure(t.id, e);
                }
              }
              // VIP-боты: второй токен у клиентов с модулем.
              const { ensureVipWebhook } = await import("@/core/tenant/vip-webhook.server");
              for (const t of tenants) {
                if (!t.modules.vip || !t.settings.vip?.token_enc) continue;
                try {
                  results[`${t.id}:vip`] = await ensureVipWebhook(t);
                } catch (e) {
                  results[`${t.id}:vip`] = await tenantFailure(t.id, e);
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
                  // Повторы исходящих (core/outbox) — та же минутная сетка.
                  outbox: await (await import("@/app/outbox/senders.server")).runOutbox(t),
                  // Уведомления о заказах, по которым решение принято 5 минут назад.
                  orderNotify: await jobs.flushOrderNotify(t),
                }),
                "cart-reminder": jobs.runCartReminders,
                // Раз в час: напоминание о дате получения, возвратные продажи, автоворонка,
                // новые уроки курсов (отдельный крон не заводим: функция на Vercel одна).
                "fulfillment-reminder": async (t: (typeof tenants)[number]) => ({
                  fulfillment: await jobs.runFulfillmentReminders(t),
                  winback: await jobs.runWinbackFor(t),
                  funnel: await jobs.runFunnelFor(t),
                  courses: await jobs.runCourseLessons(t),
                  // Неоплаченные сутки заказы с сайта — отмена и возврат остатка.
                  webOrders: await (
                    await import("@/core/storefront/web-expire")
                  ).expireWebOrders(
                    (await import("@/core/tenant/resolve.server")).tenantContext(t),
                  ),
                  // Через 3 часа без оплаты — письмо покупателю со ссылкой на заказ.
                  webReminders: await (
                    await import("@/core/storefront/web-remind")
                  ).remindWebOrders(
                    (await import("@/core/tenant/resolve.server")).tenantContext(t),
                    env().SESSION_SECRET,
                  ),
                }),
              }[params.job];
              // Клиенты — параллельно: пакет рассылки одного не задерживает других.
              const settled = await Promise.allSettled(tenants.map((t) => run(t)));
              const failures = new Map<string, unknown>();
              for (const [i, r] of settled.entries())
                if (r.status === "rejected")
                  failures.set(tenants[i]!.id, await tenantFailure(tenants[i]!.id, r.reason));
              settled.forEach((r, i) => {
                const id = tenants[i]!.id;
                results[id] = r.status === "fulfilled" ? r.value : failures.get(id);
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
                  results[t.id] = await tenantFailure(t.id, e);
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
                  results[t.id] = await tenantFailure(t.id, e);
                }
              }
              break;
            }
            case "health": {
              // Снимок здоровья каждого бота на v2 — история простоев в панели оператора
              // и сообщение оператору о сбое и восстановлении (health-alerts).
              const { recordHealthSnapshots } = await import("@/app/operator/health.server");
              results.health = await recordHealthSnapshots();
              // Аккаунты Instagram/WhatsApp: сверка профилей с Zernio, отвалившиеся — продавцу.
              const { syncZernioAccountsFor } = await import("@/channels/zernio/health.server");
              results.zernio = await syncZernioAccountsFor(tenants);
              // Зависшие события вебхука (received старше трёх минут) — тем же обработчиком.
              const { retryStuckEventsFor } = await import("@/channels/zernio/dispatch.server");
              const { tenantContext } = await import("@/core/tenant/resolve.server");
              results.zernioRetry = await retryStuckEventsFor(tenants, tenantContext);
              // Утренний дайджест продавцу — у кого настал его час.
              const { sendDueDigests } = await import("@/channels/telegram/digest.server");
              results.digest = await sendDueDigests(tenants);
              // Недельный отчёт продавцу (понедельник с 9:00) — тем же ботом магазина.
              const { sendDueWeeklyReports } = await import("@/channels/telegram/weekly.server");
              results.weekly = await sendDueWeeklyReports(tenants);
              break;
            }
            case "subscriptions": {
              // Подписки клиентов на платформу: предупредить, приостановить по политике.
              const { sweepSubscriptions } = await import("@/app/operator/billing.server");
              results.subscriptions = await sweepSubscriptions();
              // Раз в сутки — каталоги из Google Таблиц (отдельный крон не заводим:
              // функция на Vercel одна). Не скачалась или закрыта — каталог не
              // трогаем, продавцу одно сообщение.
              const { runSheetSync } = await import("@/core/catalog/sheet.server");
              const { tenantContext } = await import("@/core/tenant/resolve.server");
              const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
              for (const t of tenants) {
                try {
                  const ctx = tenantContext(t);
                  const r = await runSheetSync(ctx, "nightly");
                  if (!r) continue;
                  if (r.notify) await notifyAdminsHtml(ctx, r.notify, { kind: "system" });
                  results[`${t.id}:sheet`] = r.run.ok ? { ok: true } : r.run;
                } catch (e) {
                  results[`${t.id}:sheet`] = await tenantFailure(t.id, e);
                }
              }
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
          return null;
        }
      },
    },
  },
});
