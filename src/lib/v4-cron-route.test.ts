import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Маршрут /api/v4/cron/<job> отбирает только магазины с served_by = "v4".
 * Клиенты v1, v2 и без отметки в крон v4 не попадают: их ведёт v3 или v1.
 */

const tenant = (id: string, served_by?: string) => ({
  id,
  name: id,
  modules: {},
  settings: served_by ? { served_by } : {},
  ownerTelegramId: null,
});
const TENANTS = [
  tenant("bot-v1", "v1"),
  tenant("bot-v2", "v2"),
  tenant("bot-none"),
  tenant("bot-v4", "v4"),
];

let authorized = true;
const runs: Array<{ job: string; botIds: readonly string[] }> = [];

vi.mock("@/config/env", () => ({
  env: () => ({ CRON_SECRET: "s", APP_URL: "https://app.test" }),
}));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: () => authorized }));
vi.mock("@/lib/errors", () => ({ reportError: async () => undefined }));
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => ({}) }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => TENANTS,
  tenantContext: (t: unknown) => ({ tenant: t }),
}));
vi.mock("@/v4/jobs/cron.server", async (orig) => ({
  ...(await orig<typeof import("@/v4/jobs/cron.server")>()),
  runV4Cron: async (job: string, deps: { botIds: readonly string[] }) => {
    runs.push({ job, botIds: deps.botIds });
    return { shops: deps.botIds.length };
  },
}));

const { Route } = await import("@/routes/api/v4.cron.$job");
type Get = (a: { request: Request; params: { job: string } }) => Promise<Response>;
const GET = (Route.options as unknown as { server: { handlers: { GET: Get } } }).server.handlers
  .GET;
const call = (job: string) =>
  GET({ request: new Request(`http://x/api/v4/cron/${job}`), params: { job } });

beforeEach(() => {
  authorized = true;
  runs.length = 0;
});

describe("крон v4", () => {
  for (const job of ["tick", "jobs", "notify-now", "notify-digest"])
    it(`${job}: только магазин v4, клиенты v1, v2 и без отметки — нет`, async () => {
      const res = await call(job);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(runs).toEqual([{ job, botIds: ["bot-v4"] }]);
      expect(await res.json()).toEqual({ job: `v4:${job}`, results: { shops: 1 } });
    });

  it("без секрета крона — 401, ничего не запускается", async () => {
    authorized = false;
    expect((await call("jobs")).status).toBe(401);
    expect(runs).toEqual([]);
  });

  it("неизвестная задача — 404", async () => {
    expect((await call("vip")).status).toBe(404);
    expect(runs).toEqual([]);
  });
});
