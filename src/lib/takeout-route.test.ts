import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";

/**
 * Маршрут /api/takeout/<магазин>: архив отдаётся только по действующей
 * подписанной ссылке своего магазина и только клиенту на v2.
 */
const SHOP = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
let tenant: Record<string, unknown> | null;
let built = 0;

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async (l: { value: string }) => (tenant && l.value === SHOP ? tenant : null),
  tenantContext: (t: unknown) => ({ tenant: t }),
}));
vi.mock("@/core/export/export", async (orig) => ({
  ...(await orig<typeof import("@/core/export/export")>()),
  allDataZip: async () => {
    built++;
    return { zip: Buffer.from("PK"), counts: {} };
  },
}));

const { Route } = await import("@/routes/api/takeout.$botId");
const { takeoutLink, TAKEOUT_TTL_S } = await import("@/core/export/takeout");
const { env } = await import("@/config/env");
type Get = (a: { request: Request; params: { botId: string } }) => Promise<Response>;
const GET = (Route.options as unknown as { server: { handlers: { GET: Get } } }).server.handlers
  .GET;
const get = (botId: string, path: string) =>
  GET({ request: new Request(`http://x${path}`), params: { botId } });

beforeEach(() => {
  setEnvForTests({});
  tenant = { id: SHOP, archived: false, settings: { served_by: "v2" }, modules: {} };
  built = 0;
});

describe("архив по ссылке", () => {
  it("свежая ссылка отдаёт ZIP без кеша", async () => {
    const { path } = takeoutLink(env().SESSION_SECRET, SHOP);
    const res = await get(SHOP, path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(built).toBe(1);
  });

  it("истёкшая ссылка — 410, архив не собирается", async () => {
    const old = new Date(Date.now() - (TAKEOUT_TTL_S + 60) * 1000);
    const { path } = takeoutLink(env().SESSION_SECRET, SHOP, old);
    expect((await get(SHOP, path)).status).toBe(410);
    expect(built).toBe(0);
  });

  it("ссылка чужого магазина и без подписи — 404", async () => {
    const { path } = takeoutLink(env().SESSION_SECRET, OTHER);
    expect((await get(SHOP, path.replace(OTHER, SHOP))).status).toBe(404);
    expect((await get(SHOP, `/api/takeout/${SHOP}`)).status).toBe(404);
    expect((await get("не-идентификатор", path)).status).toBe(404);
    expect(built).toBe(0);
  });

  it("клиент прежней платформы и архивный магазин невидимы", async () => {
    const { path } = takeoutLink(env().SESSION_SECRET, SHOP);
    tenant = { id: SHOP, archived: false, settings: { served_by: "v1" } };
    expect((await get(SHOP, path)).status).toBe(404);
    tenant = { id: SHOP, archived: true, settings: { served_by: "v2" } };
    expect((await get(SHOP, path)).status).toBe(404);
    expect(built).toBe(0);
  });
});
