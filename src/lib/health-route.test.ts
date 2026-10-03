import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";

vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => [
    { id: "a", settings: { served_by: "v2" } },
    { id: "b", settings: {} },
  ],
}));

const { Route } = await import("@/routes/api/health");

afterEach(() => setEnvForTests(undefined));

describe("/api/health", () => {
  it("говорит, какая сборка сейчас живая: коммит и ветка", async () => {
    setEnvForTests({
      VERCEL_GIT_COMMIT_SHA: "9b4045f0123",
      VERCEL_GIT_COMMIT_REF: "master",
      VERCEL_ENV: "production",
    });
    const { GET } = (
      Route.options as unknown as { server: { handlers: { GET: () => Promise<Response> } } }
    ).server.handlers;
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      commit: "9b4045f0123",
      branch: "master",
      env: "production",
      tenantsOnV2: 1,
    });
  });

  it("без переменных сборки коммит и ветка — null, а не ошибка", async () => {
    setEnvForTests({});
    const { GET } = (
      Route.options as unknown as { server: { handlers: { GET: () => Promise<Response> } } }
    ).server.handlers;
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, commit: null, branch: null });
  });

  it("version: 3 и отчёт об окружении: только имена, без значений", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "zk-very-secret" });
    const { GET } = (
      Route.options as unknown as { server: { handlers: { GET: () => Promise<Response> } } }
    ).server.handlers;
    const text = await (await GET()).text();
    expect(text).not.toContain("zk-very-secret");
    const body = JSON.parse(text) as {
      version: number;
      ok: boolean;
      envReport: { ok: boolean; vars: { name: string; kind: string; set: boolean }[] };
    };
    expect(body.version).toBe(3);
    expect(body.envReport.ok).toBe(true);
    expect(body.envReport.vars.find((v) => v.name === "ZERNIO_API_KEY")).toMatchObject({
      kind: "feature",
      set: true,
    });
    expect(body.envReport.vars.find((v) => v.name === "SMTP_HOST")).toMatchObject({
      kind: "feature",
      set: false,
    });
  });

  it("нет обязательной переменной: ok: false, отчёт всё равно отдан", async () => {
    setEnvForTests(undefined);
    vi.stubEnv("APP_URL", "");
    const { GET } = (
      Route.options as unknown as { server: { handlers: { GET: () => Promise<Response> } } }
    ).server.handlers;
    const body = (await (await GET()).json()) as {
      ok: boolean;
      commit: null;
      envReport: { ok: boolean; missingRequired: string[] };
    };
    vi.unstubAllEnvs();
    expect(body.ok).toBe(false);
    expect(body.envReport.ok).toBe(false);
    expect(body.envReport.missingRequired).toContain("APP_URL");
    expect(body.commit).toBeNull();
  });
});
