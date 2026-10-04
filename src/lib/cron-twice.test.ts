import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Окно переключения v2 → v3: два крона могут сработать одновременно. Для
 * каждой задачи из JOBS (src/lib/cron-route.test.ts) здесь указано, где лежит
 * тест «два прогона параллельно — одно сообщение, одна отметка, одна награда»,
 * или почему повтор безвреден. Новая задача без записи здесь — красный тест.
 */
type Evidence = { test: string[] } | { idempotent: string };

const TWICE: Record<string, Evidence> = {
  // ensure-webhook
  webhook: { idempotent: "setWebhook с тем же адресом и секретом ничего не меняет, сообщений нет" },
  vipWebhook: { idempotent: "то же: повторная установка вебхука VIP-бота" },
  // broadcast
  broadcast: { test: ["src/core/broadcasts/broadcasts.test.ts"] },
  waBroadcast: { test: ["src/core/broadcasts/broadcasts.test.ts"] }, // тот же processBroadcastBatch, канал whatsapp
  outbox: { test: ["src/core/outbox/outbox.test.ts"] },
  orderNotify: { test: ["src/channels/telegram/order-notify.test.ts"] },
  unanswered: { test: ["src/core/chat/unanswered.test.ts"] },
  overdueTickets: { test: ["src/core/helpdesk/overdue.test.ts"] },
  // cart-reminder
  cartReminder: { test: ["src/lib/cron-twice-marketing.test.ts"] },
  // fulfillment-reminder
  fulfillment: { test: ["src/core/reminders/fulfillment.test.ts"] },
  winback: { test: ["src/lib/cron-twice-marketing.test.ts"] },
  similar: { test: ["src/lib/cron-twice-marketing.test.ts"] },
  reviewAsk: { test: ["src/core/reviews/ask.test.ts"] },
  funnel: { test: ["src/lib/cron-twice-marketing.test.ts"] },
  courses: { test: ["src/core/courses/announce.test.ts", "src/core/courses/reminders.test.ts"] },
  webOrders: { test: ["src/core/orders/reject-points.test.ts"] },
  webReminders: { test: ["src/core/storefront/web-remind.test.ts"] },
  chatPayReminders: { test: ["src/core/orders/pay-remind.test.ts"] },
  saleEnding: { test: ["src/core/offers/announce.test.ts"] },
  // course-lives
  courseLives: { test: ["src/core/courses/live-remind.test.ts"] },
  // vip
  vip: { test: ["src/core/vip/cron-twice.test.ts"] },
  // giveaways
  giveaways: { test: ["src/channels/giveaway-cron.test.ts", "src/core/giveaways/notify.test.ts"] },
  // comment-dm-fallback
  commentDm: { test: ["src/channels/zernio/comment-dm-fallback.test.ts"] },
  // health
  zernioSync: { idempotent: "сверка аккаунтов Zernio пишет снимок состояния, сообщений не шлёт" },
  channelGuard: { test: ["src/channels/zernio/guard.server.test.ts"] },
  zernioRetry: { test: ["src/channels/zernio/retry.test.ts"] },
  pricelist: { test: ["src/channels/zernio/consultant-jobs.test.ts"] },
  digest: { test: ["src/channels/telegram/digest-twice.test.ts"] },
  weekly: { test: ["src/core/analytics/weekly.test.ts"] },
  morning: { test: ["src/app/operator/morning-brief.server.test.ts"] },
  // subscriptions
  catalogSheet: { test: ["src/core/catalog/sheet.test.ts"] },
  sheetNotify: { test: ["src/core/catalog/sheet.test.ts"] },
  renewals: { test: ["src/app/operator/renewals.server.test.ts"] },
  // Не задачи арендатора из JOBS, но в тех же кронах (SELF_SCOPED и обходы платформы).
  sweepSubscriptions: { test: ["src/app/operator/subscription-sweep.test.ts"] },
  leads: { test: ["src/app/operator/leads-pipeline.server.test.ts"] },
  retention: { test: ["src/app/admin/deletion-twice.test.ts"] },
};

/** Ключи JOBS и их задачи — прямо из текста cron-route.test.ts, чтобы списки не разошлись. */
function jobsFromCronRouteTest(): Record<string, string[]> {
  const src = readFileSync("src/lib/cron-route.test.ts", "utf8");
  const block = /const JOBS: Record<string, string\[\]> = (\{[\s\S]*?\n\});/.exec(src)?.[1];
  if (!block) throw new Error("не нашёл JOBS в cron-route.test.ts");
  return new Function(`return ${block}`)() as Record<string, string[]>;
}

describe("кроны дважды: у каждой задачи есть тест или причина", () => {
  const tasks = Object.values(jobsFromCronRouteTest()).flat();

  it("список задач не пуст", () => {
    expect(tasks.length).toBeGreaterThan(20);
  });

  for (const task of tasks)
    it(`${task}: указан тест двух параллельных прогонов или причина безвредности`, () => {
      expect(TWICE[task], `добавьте ${task} в TWICE (src/lib/cron-twice.test.ts)`).toBeDefined();
    });

  it("указанные тесты существуют и действительно запускают два прогона разом", () => {
    for (const [task, ev] of Object.entries(TWICE)) {
      if (!("test" in ev)) {
        expect(ev.idempotent.length, task).toBeGreaterThan(10);
        continue;
      }
      for (const file of ev.test) {
        expect(existsSync(file), `${task}: нет файла ${file}`).toBe(true);
        const text = readFileSync(file, "utf8");
        expect(text, `${task}: в ${file} нет Promise.all`).toMatch(/Promise\.all/);
        expect(text, `${task}: в ${file} нет теста про одновременные прогоны`).toMatch(
          /одновременно|параллельн|пересёкш|два (крона|прогона|запуска)/i,
        );
      }
    }
  });

  it("в списке нет лишних задач, которых нет в кронах", () => {
    const known = new Set([...tasks, "sweepSubscriptions", "leads", "retention"]);
    for (const task of Object.keys(TWICE)) expect(known.has(task), task).toBe(true);
  });
});
