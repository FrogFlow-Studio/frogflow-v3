import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserError } from "@/core/i18n/user-error";

/**
 * Отказ с текстом для человека из крона клиента («vip_group_id не настроен») —
 * настройка, а не сбой кода: виден оператору в итоге крона и не уходит в Sentry
 * (FROGFLOW-V2-F, каждые полчаса). Настоящий сбой по-прежнему уходит.
 */

const V2 = {
  id: "bot-v2",
  modules: { vip: true },
  settings: { served_by: "v2", vip: { token_enc: "x", username: "vipbot" } },
};

const reported: unknown[] = [];
let failWith: Error = new Error("не задано");

vi.mock("@/config/env", () => ({ env: () => ({ CRON_SECRET: "s" }) }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: () => true }));
vi.mock("@/lib/errors", () => ({
  reportError: async (e: unknown) => {
    reported.push(e);
  },
}));
vi.mock("@/app/operator/cron-status.server", () => ({
  recordCronRun: async () => undefined,
  readCronResume: async () => null,
  summarizeResults: () => "",
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => [V2],
  tenantContext: (tenant: unknown) => ({ tenant }),
}));
vi.mock("@/channels/telegram/vip/group", () => ({ vipGroupApi: () => ({}) }));
vi.mock("@/channels/telegram/vip/handle", () => ({ vipTelegramApi: () => ({}) }));
vi.mock("@/core/vip/cron", () => ({
  runVipCron: async () => {
    throw failWith;
  },
}));

const { Route } = await import("@/routes/api/cron.$job");

type Get = (a: { request: Request; params: { job: string } }) => Promise<Response>;
const GET = (Route.options as unknown as { server: { handlers: { GET: Get } } }).server.handlers
  .GET;

const runVip = async () => {
  const res = await GET({ request: new Request("http://x/api/cron/vip"), params: { job: "vip" } });
  expect(res.status).toBe(200);
  return (await res.json()) as { results: Record<string, unknown> };
};

beforeEach(() => {
  reported.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("крон: отказ настройки клиента — не сбой", () => {
  it("UserError виден в итоге крона и не уходит в учёт ошибок", async () => {
    failWith = new UserError(
      "err.vip.cronGroupIdMissing",
      "vip_group_id не настроен в настройках VIP",
    );
    const { results } = await runVip();
    expect(results["bot-v2"]).toEqual({
      ok: false,
      setup: true,
      error: "vip_group_id не настроен в настройках VIP",
    });
    expect(reported).toEqual([]);
  });

  it("настоящий сбой по-прежнему уходит в учёт ошибок", async () => {
    failWith = new Error("Telegram 502");
    const { results } = await runVip();
    expect(results["bot-v2"]).toEqual({ ok: false, error: "Telegram 502" });
    expect(reported).toEqual([failWith]);
  });
});
