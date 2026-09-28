import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Маршрут /api/cron/<job> сам отбирает клиентов v2 — одной строкой фильтра
 * по settings.served_by. Всё, что крон делает дальше (рассылки, возврат
 * клиентов, «похожие материалы», автоворонка, уроки курсов, напоминания, вебхуки, каталоги из
 * Google Таблиц), получает уже отобранный список. Сломайся фильтр — возврат клиентов написал бы
 * покупателям магазинов, которые живут на v1. Здесь каждая задача каждого
 * крона подменена записью «кого обошли», и клиентов v1 в ней быть не должно.
 */

const V2 = {
  id: "bot-v2",
  modules: { vip: true, instagram: true },
  settings: {
    served_by: "v2",
    vip: { token_enc: "x", username: "vipbot" },
    zernio: { profile_id: "p", account_ids: ["a"] },
  },
};
const V1 = {
  id: "bot-v1",
  modules: { vip: true, instagram: true },
  settings: {
    served_by: "v1",
    vip: { token_enc: "x", username: "vipbot" },
    zernio: { profile_id: "p", account_ids: ["a"] },
  },
};
const NONE = {
  id: "bot-none",
  modules: { vip: true, instagram: true },
  settings: {
    vip: { token_enc: "x", username: "vipbot" },
    zernio: { profile_id: "p", account_ids: ["a"] },
  },
};

const seen: Record<string, string[]> = {};
const hit = (task: string) => (t: { id: string } | { tenant: { id: string } }) => {
  const id = "tenant" in t ? t.tenant.id : t.id;
  (seen[task] ??= []).push(id);
  return { ok: true };
};
const hitList = (task: string) => (list: { id: string }[]) => {
  for (const t of list) (seen[task] ??= []).push(t.id);
  return { ok: true };
};

vi.mock("@/config/env", () => ({ env: () => ({ CRON_SECRET: "s" }) }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: () => true }));
vi.mock("@/lib/errors", () => ({ reportError: async () => undefined }));
vi.mock("@/app/operator/cron-status.server", () => ({
  recordCronRun: async () => undefined,
  summarizeResults: () => "",
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => [V2, V1, NONE],
  tenantContext: (tenant: unknown) => ({ tenant }),
}));
vi.mock("@/core/tenant/telegram-webhook.server", () => ({ ensureTelegramWebhook: hit("webhook") }));
vi.mock("@/core/tenant/vip-webhook.server", () => ({ ensureVipWebhook: hit("vipWebhook") }));
vi.mock("@/channels/zernio/connect.server", () => ({
  v2WebhookStatus: async () => ({ ok: true }),
  // Запись вебхука Zernio пишет только оператор кнопкой — крон её не вызывает.
  syncV2Webhook: async () => {
    throw new Error("крон не должен писать вебхук Zernio");
  },
}));
vi.mock("@/channels/telegram/jobs", () => ({
  runBroadcastBatch: hit("broadcast"),
  flushOrderNotify: hit("orderNotify"),
  runUnansweredChats: hit("unanswered"),
  runCartReminders: hit("cartReminder"),
  runFulfillmentReminders: hit("fulfillment"),
  runWinbackFor: hit("winback"),
  runSimilarFor: hit("similar"),
  runFunnelFor: hit("funnel"),
  runBirthdaysFor: hit("birthdays"),
  runCourseLessons: hit("courses"),
}));
vi.mock("@/core/storefront/web-expire", () => ({ expireWebOrders: hit("webOrders") }));
vi.mock("@/core/storefront/web-remind", () => ({ remindWebOrders: hit("webReminders") }));
vi.mock("@/app/orders/pay-remind.server", () => ({
  runChatPayReminders: hit("chatPayReminders"),
}));
vi.mock("@/channels/zernio/jobs", () => ({ runWhatsAppBroadcastBatch: hit("waBroadcast") }));
vi.mock("@/app/outbox/senders.server", () => ({ runOutbox: hit("outbox") }));
vi.mock("@/core/vip/cron", () => ({ runVipCron: hit("vip") }));
vi.mock("@/channels/telegram/vip/group", () => ({ vipGroupApi: () => ({}) }));
vi.mock("@/channels/telegram/vip/handle", () => ({ vipTelegramApi: () => ({}) }));
vi.mock("@/channels/zernio/automations.server", () => ({ runCommentDmFallback: hit("commentDm") }));
vi.mock("@/app/operator/health.server", () => ({ recordHealthSnapshots: async () => ({}) }));
vi.mock("@/channels/zernio/health.server", () => ({
  syncZernioAccountsFor: hitList("zernioSync"),
}));
vi.mock("@/channels/zernio/dispatch.server", () => ({
  retryStuckEventsFor: hitList("zernioRetry"),
}));
vi.mock("@/channels/telegram/digest.server", () => ({ sendDueDigests: hitList("digest") }));
vi.mock("@/channels/telegram/weekly.server", () => ({
  sendDueWeeklyReports: hitList("weekly"),
}));
vi.mock("@/app/operator/billing.server", () => ({ sweepSubscriptions: async () => ({}) }));
vi.mock("@/core/catalog/sheet.server", () => ({
  runSheetSync: (ctx: { tenant: { id: string } }) => {
    hit("catalogSheet")(ctx);
    return { run: { ok: true }, notify: "таблица закрыта" };
  },
}));
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml: hit("sheetNotify") }));

const { Route } = await import("@/routes/api/cron.$job");

type Get = (a: { request: Request; params: { job: string } }) => Promise<Response>;
const GET = (Route.options as unknown as { server: { handlers: { GET: Get } } }).server.handlers
  .GET;

const run = async (job: string) => {
  const res = await GET({ request: new Request(`http://x/api/cron/${job}`), params: { job } });
  expect(res.status).toBe(200);
  return (await res.json()) as { tenants: number };
};

beforeEach(() => {
  for (const k of Object.keys(seen)) delete seen[k];
});

const JOBS: Record<string, string[]> = {
  "ensure-webhook": ["webhook", "vipWebhook"],
  broadcast: ["broadcast", "waBroadcast", "outbox", "orderNotify", "unanswered"],
  "cart-reminder": ["cartReminder"],
  "fulfillment-reminder": [
    "fulfillment",
    "winback",
    "similar",
    "funnel",
    "courses",
    "webOrders",
    "webReminders",
    "chatPayReminders",
  ],
  vip: ["vip"],
  "comment-dm-fallback": ["commentDm"],
  health: ["zernioSync", "zernioRetry", "digest", "weekly"],
  subscriptions: ["catalogSheet", "sheetNotify"],
};

describe("кроны обходят только клиентов v2", () => {
  for (const [job, tasks] of Object.entries(JOBS))
    it(`${job}: клиент v1 и клиент без served_by не попадают ни в одну задачу`, async () => {
      expect((await run(job)).tenants).toBe(1);
      for (const task of tasks) expect(seen[task], task).toEqual(["bot-v2"]);
    });
});

describe("новый крон не проскакивает мимо проверки", () => {
  // Отбирают клиентов v2 сами, их проверки — рядом с кодом:
  // retention — core/retention (runRetention без границ), subscriptions — ещё и
  // app/operator/subscription-sweep.test (sweepSubscriptions).
  const SELF_SCOPED = ["retention"];
  const covered = [...Object.keys(JOBS), ...SELF_SCOPED].sort();

  it("каждая задача маршрута и каждый крон vercel.json есть в списке проверенных", () => {
    const route = readFileSync("src/routes/api/cron.$job.ts", "utf8");
    const cases = [...route.matchAll(/case "([a-z-]+)"/g)].map((m) => m[1]!).sort();
    expect(cases).toEqual(covered);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: Array<{ path: string }>;
    };
    for (const c of vercel.crons) {
      const job = /^\/api\/cron\/([a-z-]+)$/.exec(c.path)?.[1];
      expect(covered, c.path).toContain(job);
    }
  });
});
