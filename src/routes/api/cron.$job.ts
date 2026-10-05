import { withNoStore } from "@/app/cache-policy";
import { createFileRoute } from "@tanstack/react-router";
import { previewWebhookResponse } from "@/lib/preview";
import { env } from "@/config/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { reportError } from "@/lib/errors";
import { cronBudget, eachWithin, inTurn, mapWithin, resumeOf } from "@/lib/cron-budget";

/**
 * Кроны одного деплоя обходят всех арендаторов. Каждая задача — функция
 * от Tenant; сбой у одного клиента не останавливает остальных.
 */
export const Route = createFileRoute("/api/cron/$job")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isCronAuthorized(request, env().CRON_SECRET))
          return withNoStore(new Response("unauthorized", { status: 401 }));
        const preview = previewWebhookResponse();
        if (preview) return preview;
        const { tenantDirectory } = await import("@/core/tenant/resolve.server");
        const tenants = (await tenantDirectory(true)).filter((t) => t.settings.served_by === "v2");
        const results: Record<string, unknown> = {};
        const startedAt = Date.now();
        const { recordCronRun, summarizeResults, readCronResume } =
          await import("@/app/operator/cron-status.server");
        // Общий бюджет времени: работа по клиентам останавливается до предела
        // функции, следующий запуск продолжает с первого пропущенного (lib/cron-budget).
        const budget = cronBudget(startedAt);
        const resumeFrom = await readCronResume(params.job).catch(() => null);
        const ordered = inTurn(tenants, resumeFrom);
        const skipped = new Set<string>();
        let resume: string | null = null;
        const finish = async (ok: boolean, error: string | null) => {
          if (skipped.size) results.budget = { skipped: skipped.size, resume };
          await recordCronRun(params.job, {
            at: new Date().toISOString(),
            ok,
            durationMs: Date.now() - startedAt,
            tenants: tenants.length,
            summary: summarizeResults(results),
            error,
            resume,
            skipped: skipped.size,
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
        return withNoStore(Response.json({ job: params.job, tenants: tenants.length, results }));

        async function runJob(): Promise<Response | null> {
          switch (params.job) {
            case "ensure-webhook": {
              const { ensureTelegramWebhook } =
                await import("@/channels/telegram/webhook-setup.server");
              await eachWithin(ordered, budget, skipped, async (t) => {
                try {
                  results[t.id] = await ensureTelegramWebhook(t);
                } catch (e) {
                  results[t.id] = await tenantFailure(t.id, e);
                }
              });
              // VIP-боты: второй токен у клиентов с модулем.
              const { ensureVipWebhook } =
                await import("@/channels/telegram/vip-webhook-setup.server");
              await eachWithin(ordered, budget, skipped, async (t) => {
                if (!t.modules.vip || !t.settings.vip?.token_enc) return;
                try {
                  results[`${t.id}:vip`] = await ensureVipWebhook(t);
                } catch (e) {
                  results[`${t.id}:vip`] = await tenantFailure(t.id, e);
                }
              });
              // Быстрые вопросы Instagram: только клиентам v2 и только когда набор сменился.
              const { ensureIceBreakers } = await import("@/channels/zernio/ice-breakers.server");
              await eachWithin(ordered, budget, skipped, async (t) => {
                if (!t.settings.zernio?.accounts?.length) return;
                try {
                  const r = await ensureIceBreakers(t);
                  if (r.action !== "skipped" && r.action !== "unchanged")
                    results[`${t.id}:ice_breakers`] = r;
                } catch (e) {
                  results[`${t.id}:ice_breakers`] = await tenantFailure(t.id, e);
                }
              });
              // Zernio: запись вебхука v2 крон только читает — писать её может лишь
              // оператор кнопкой (записи v1 с тем же ключом код v2 не трогает).
              const zernioInUse = tenants.some(
                (t) => t.settings.zernio?.profile_id || t.settings.zernio?.account_ids?.length,
              );
              if (zernioInUse) {
                const { v2WebhookStatus } = await import("@/channels/zernio/connect.server");
                results.zernio = await v2WebhookStatus();
              } else
                results.zernio = { ok: true, action: "skipped", error: "нет клиентов v2 с Zernio" };
              resume = resumeOf(ordered, skipped);
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
                  // Диалоги без ответа — напоминание продавцу (страница «Чат»).
                  unanswered: await jobs.runUnansweredChats(t),
                  // Обращения без ответа дольше N часов — напоминание продавцу (страница «Обращения»).
                  overdueTickets: await jobs.runOverdueTickets(t),
                }),
                "cart-reminder": jobs.runCartReminders,
                // Раз в час: напоминание о дате получения, возвратные продажи, «похожие материалы», автоворонка,
                // новые уроки курсов (отдельный крон не заводим: функция на Vercel одна).
                "fulfillment-reminder": async (t: (typeof tenants)[number]) => ({
                  fulfillment: await jobs.runFulfillmentReminders(t),
                  // Поздравление — раз в год, раньше прочих автосообщений: в день рождения
                  // потолок «одно маркетинговое в сутки» достаётся ему (core/marketing/cap).
                  birthdays: await jobs.runBirthdaysFor(t),
                  winback: await jobs.runWinbackFor(t),
                  similar: await jobs.runSimilarFor(t),
                  // Просьба об оценке через N дней после выдачи заказа.
                  reviewAsk: await jobs.runReviewAskFor(t),
                  funnel: await jobs.runFunnelFor(t),
                  // Акция кончается завтра — тем, кого звали на неё рассылкой.
                  saleEnding: await jobs.runSaleReminders(t),
                  // «Товар появился» — тем, кого первая рассылка не успела или не пустил суточный потолок.
                  waitlist: await jobs.runWaitlistCatchupFor(t),
                  subscriptions: await jobs.runSubscriptionsFor(t),
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
                  // Заказ из бота, Instagram, WhatsApp ждёт оплаты N часов — одно напоминание (выкл. по умолчанию).
                  chatPayReminders: await (
                    await import("@/app/orders/pay-remind.server")
                  ).runChatPayReminders(t),
                  // Каталог площадки: согласный и одобренный магазин попадает в /market, остальные убираются.
                  marketplace: await (
                    await import("@/core/marketplace/shops.server")
                  ).refreshMarketplaceShop(
                    (await import("@/core/tenant/resolve.server")).tenantContext(t),
                    undefined,
                    // Большой магазин делится между запусками: бюджет кончился — курсор и дальше.
                    { spent: budget.spent },
                  ),
                }),
              }[params.job];
              // Клиенты — параллельно (по CRON_CONCURRENCY): пакет рассылки одного не
              // задерживает других; не начатые к концу бюджета ждут следующего запуска.
              const settled = await mapWithin<(typeof ordered)[number], unknown>(
                ordered,
                budget,
                skipped,
                (t) => run(t),
              );
              for (const t of ordered) {
                const r = settled.get(t.id);
                if (!r || r.status === "skipped") continue;
                results[t.id] =
                  r.status === "fulfilled" ? r.value : await tenantFailure(t.id, r.reason);
              }
              resume = resumeOf(ordered, skipped);
              break;
            }
            case "giveaways": {
              // Розыгрыши: закрыть приём по сроку, выбрать победителей, написать им, отчитаться продавцу.
              const { runGiveawaysFor } = await import("@/channels/giveaway-cron.server");
              await eachWithin(ordered, budget, skipped, async (t) => {
                try {
                  results[t.id] = await runGiveawaysFor(t);
                } catch (e) {
                  results[t.id] = await tenantFailure(t.id, e);
                }
              });
              resume = resumeOf(ordered, skipped);
              break;
            }
            case "vip": {
              // Напоминания об истечении и исключение из VIP-групп.
              const { runVipCron } = await import("@/core/vip/cron");
              const { tenantContext } = await import("@/core/tenant/resolve.server");
              const { vipGroupApi } = await import("@/channels/telegram/vip/group");
              const { vipTelegramApi } = await import("@/channels/telegram/vip/handle");
              await eachWithin(ordered, budget, skipped, async (t) => {
                if (!t.modules.vip || !t.settings.vip?.token_enc) return;
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
              });
              resume = resumeOf(ordered, skipped);
              break;
            }
            case "course-lives": {
              // Напоминания об эфирах потока за сутки и за час: сетка в 10 минут.
              const { runCourseLives } = await import("@/channels/telegram/jobs");
              await eachWithin(ordered, budget, skipped, async (t) => {
                if (!t.modules.courses) return;
                try {
                  results[t.id] = await runCourseLives(t);
                } catch (e) {
                  results[t.id] = await tenantFailure(t.id, e);
                }
              });
              resume = resumeOf(ordered, skipped);
              break;
            }
            case "comment-dm-fallback": {
              // Резервная DM по комментариям Instagram, если родное правило Zernio замолчало.
              const { runCommentDmFallback } = await import("@/channels/zernio/automations.server");
              const { tenantContext } = await import("@/core/tenant/resolve.server");
              // 429 Zernio — лимит на весь ключ: остальным клиентам тоже не писать до следующего запуска.
              let zernioLimitedSec: number | null = null;
              await eachWithin(ordered, budget, skipped, async (t) => {
                if (!t.modules.instagram || !t.settings.zernio?.profile_id) return;
                if (zernioLimitedSec !== null) {
                  results[t.id] = { skipped: "zernio rate limit", retryAfterSec: zernioLimitedSec };
                  return;
                }
                try {
                  const r = await runCommentDmFallback(
                    tenantContext(t),
                    undefined,
                    undefined,
                    budget.spent,
                  );
                  if (r.rateLimitedSec !== undefined) zernioLimitedSec = r.rateLimitedSec;
                  results[t.id] = r;
                } catch (e) {
                  results[t.id] = await tenantFailure(t.id, e);
                }
              });
              resume = resumeOf(ordered, skipped);
              break;
            }
            case "health": {
              // Девять этапов; каждый обходит клиентов сам. На бюджете останавливаемся
              // между этапами, следующий запуск начинает с первого пропущенного, чтобы
              // дайджест и недельный отчёт в хвосте не голодали (resume — имя этапа).
              const { tenantContext } = await import("@/core/tenant/resolve.server");
              const stages: Array<{ id: string; run: () => Promise<void> }> = [
                {
                  // Снимок здоровья каждого бота на v2 — история простоев в панели оператора
                  // и сообщение оператору о сбое и восстановлении (health-alerts).
                  id: "health",
                  run: async () => {
                    const { recordHealthSnapshots } = await import("@/app/operator/health.server");
                    results.health = await recordHealthSnapshots();
                  },
                },
                {
                  // Аккаунты Instagram/WhatsApp: сверка профилей с Zernio, отвалившиеся — продавцу.
                  id: "zernio",
                  run: async () => {
                    const { syncZernioAccountsFor } =
                      await import("@/channels/zernio/health.server");
                    results.zernio = await syncZernioAccountsFor(tenants);
                  },
                },
                {
                  // Страж каналов: слетевший токен, отключённый вебхук Zernio — продавцу в Telegram
                  // один раз на событие и «снова работает» при восстановлении (по свежему снимку).
                  id: "channelGuard",
                  run: async () => {
                    const { tenantDirectory } = await import("@/core/tenant/resolve.server");
                    const fresh = (await tenantDirectory(true)).filter(
                      (t) => t.settings.served_by === "v2",
                    );
                    const inUse = fresh.some((t) => t.settings.zernio?.accounts?.length);
                    const { v2WebhookStatus } = await import("@/channels/zernio/connect.server");
                    const hook = inUse ? await v2WebhookStatus().catch(() => null) : null;
                    // Не удалось проверить — не повод будить продавца.
                    const webhookOk = !hook || hook.action === "error" ? null : hook.ok;
                    const { runChannelGuardFor } = await import("@/channels/zernio/guard.server");
                    results.channelGuard = await runChannelGuardFor(fresh, webhookOk);
                  },
                },
                {
                  // Зависшие события вебхука (received старше трёх минут) — тем же обработчиком.
                  id: "zernioRetry",
                  run: async () => {
                    const { retryStuckEventsFor } =
                      await import("@/channels/zernio/dispatch.server");
                    results.zernioRetry = await retryStuckEventsFor(tenants, tenantContext);
                  },
                },
                {
                  // Оповещения оператору о платформе: кроны, вебхук Zernio v2, отвалившиеся
                  // аккаунты Instagram/WhatsApp (после сверки выше — по свежему снимку).
                  id: "platformAlerts",
                  run: async () => {
                    const { runPlatformAlerts } =
                      await import("@/app/operator/platform-alerts.server");
                    results.platformAlerts = await runPlatformAlerts();
                  },
                },
                {
                  // Модель ИИ-консультанта перестала отвечать (баланс, ключ, лимит) — оператору.
                  id: "consultantModel",
                  run: async () => {
                    const { runConsultantModelAlerts } =
                      await import("@/app/operator/consultant-alerts.server");
                    results.consultantModel = await runConsultantModelAlerts(tenants);
                  },
                },
                {
                  // Консультант по прайсу: свежий курс рубля и напоминание замолчавшему покупателю.
                  id: "pricelist",
                  run: async () => {
                    const { runPricelistJobs } =
                      await import("@/channels/zernio/consultant-jobs.server");
                    results.pricelist = await runPricelistJobs(tenants);
                  },
                },
                {
                  // Утренний дайджест продавцу — у кого настал его час.
                  id: "digest",
                  run: async () => {
                    const { sendDueDigests } = await import("@/channels/telegram/digest.server");
                    results.digest = await sendDueDigests(tenants);
                  },
                },
                {
                  // Недельный отчёт продавцу (понедельник с 9:00) — тем же ботом магазина.
                  id: "weekly",
                  run: async () => {
                    const { sendDueWeeklyReports } =
                      await import("@/channels/telegram/weekly.server");
                    results.weekly = await sendDueWeeklyReports(tenants);
                  },
                },
                {
                  // Утренняя сводка оператору «кому позвонить» — раз в день после 8:00.
                  id: "morning",
                  run: async () => {
                    const { runMorningBrief } = await import("@/app/operator/morning-brief.server");
                    results.morning = await runMorningBrief(tenants);
                  },
                },
              ];
              const turn = inTurn(stages, resumeFrom, false);
              await eachWithin(turn, budget, skipped, (stage) => stage.run());
              resume = resumeOf(turn, skipped);
              break;
            }
            case "subscriptions": {
              // Подписки клиентов на платформу: предупредить, приостановить по политике.
              const { sweepSubscriptions } = await import("@/app/operator/billing.server");
              results.subscriptions = await sweepSubscriptions();
              // Пробный период: одно напоминание за 3 дня и одно в последний день.
              try {
                const { remindTrials } = await import("@/app/operator/trial-remind.server");
                results.trials = await remindTrials(tenants);
              } catch (e) {
                results.trials = await tenantFailure("trial", e);
              }
              // Платящим: напоминание за 7, 3 и 1 день и в день окончания (воронка продлений).
              try {
                const { runRenewals } = await import("@/app/operator/renewals.server");
                results.renewals = await runRenewals(tenants);
              } catch (e) {
                results.renewals = await tenantFailure("renewals", e);
              }
              // Раз в сутки — каталоги из Google Таблиц (отдельный крон не заводим:
              // функция на Vercel одна). Не скачалась или закрыта — каталог не
              // трогаем, продавцу одно сообщение.
              const { runSheetSync } = await import("@/core/catalog/sheet.server");
              const { tenantContext } = await import("@/core/tenant/resolve.server");
              const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
              await eachWithin(ordered, budget, skipped, async (t) => {
                try {
                  const ctx = tenantContext(t);
                  const r = await runSheetSync(ctx, "nightly");
                  if (!r) return;
                  if (r.notify) await notifyAdminsHtml(ctx, r.notify, { kind: "system" });
                  results[`${t.id}:sheet`] = r.run.ok ? { ok: true } : r.run;
                } catch (e) {
                  results[`${t.id}:sheet`] = await tenantFailure(t.id, e);
                }
              });
              resume = resumeOf(ordered, skipped);
              break;
            }
            case "retention": {
              // Один проход на всех клиентов: журналы, переписка, попытки входа.
              const { runRetention } = await import("@/core/retention/retention");
              results.retention = await runRetention();
              // Удаление магазина по запросу владельца: холд 30 дней истёк — архив и файлы.
              const { finalizeDueDeletions } = await import("@/app/admin/deletion.server");
              results.deletion = await finalizeDueDeletions(tenants);
              break;
            }
            case "leads": {
              // Конвейер лидов оператора: платформа, не арендатор. По умолчанию выключен
              // (флаг v3_lead_cron): v1 гоняет свой крон по той же sales_leads.
              const { runLeadPipeline } = await import("@/app/operator/leads-pipeline.server");
              results.leads = await runLeadPipeline();
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
