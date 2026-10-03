import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Бюджет времени на настоящем маршруте крона (Б30): клиент, до которого не
 * дошла очередь, не начат; следующий запуск начинает с него и обрабатывает
 * его ровно один раз. Часы — подставные: каждый клиент «работает» 60 с.
 */
const tenant = (id: string) => ({
  id,
  modules: { vip: true },
  settings: { served_by: "v2", vip: { token_enc: "x", username: "vipbot" } },
});
const TENANTS = ["bot-c", "bot-a", "bot-b"].map(tenant);

let clock = 0;
const processed: string[] = [];
let saved: { resume?: string | null } | null = null;

vi.mock("@/config/env", () => ({ env: () => ({ CRON_SECRET: "s" }) }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: () => true }));
vi.mock("@/lib/errors", () => ({ reportError: async () => undefined }));
vi.mock("@/app/operator/cron-status.server", () => ({
  recordCronRun: async (_job: string, run: { resume?: string | null }) => {
    saved = run;
  },
  readCronResume: async () => saved?.resume ?? null,
  summarizeResults: () => "",
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => TENANTS,
  tenantContext: (t: unknown) => ({ tenant: t }),
}));
vi.mock("@/core/vip/cron", () => ({
  runVipCron: async (ctx: { tenant: { id: string } }) => {
    processed.push(ctx.tenant.id);
    clock += 60_000;
    return { ok: true };
  },
}));
vi.mock("@/channels/telegram/vip/group", () => ({ vipGroupApi: () => ({}) }));
vi.mock("@/channels/telegram/vip/handle", () => ({ vipTelegramApi: () => ({}) }));

const { Route } = await import("@/routes/api/cron.$job");
type Get = (a: { request: Request; params: { job: string } }) => Promise<Response>;
const GET = (Route.options as unknown as { server: { handlers: { GET: Get } } }).server.handlers
  .GET;
const runVip = async () => {
  processed.length = 0;
  const res = await GET({
    request: new Request("http://x/api/cron/vip"),
    params: { job: "vip" },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { results: Record<string, unknown> };
};

beforeEach(() => {
  clock = 0;
  saved = null;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});

describe("крон vip: бюджет времени", () => {
  it("клиент за бюджетом не начат, следующий запуск обрабатывает его один раз", async () => {
    // Бюджет 100 с, клиент 60 с: в запуск влезают двое из трёх.
    const first = await runVip();
    expect(processed).toEqual(["bot-a", "bot-b"]);
    expect(first.results.budget).toEqual({ skipped: 1, resume: "bot-c" });
    expect(saved?.resume).toBe("bot-c");

    clock += 3_600_000;
    const second = await runVip();
    // Очередь пошла с пропущенного; bot-c — один раз.
    expect(processed.filter((id) => id === "bot-c")).toEqual(["bot-c"]);
    expect(processed[0]).toBe("bot-c");
    expect(second.results["bot-c"]).toEqual({ ok: true });
  });

  it("всех успели — resume пуст, следующий запуск идёт с начала", async () => {
    vi.spyOn(Date, "now").mockImplementation(() => 0); // время стоит
    await runVip();
    expect(processed).toEqual(["bot-a", "bot-b", "bot-c"]);
    expect(saved?.resume).toBeNull();
  });
});
