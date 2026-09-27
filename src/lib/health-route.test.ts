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
});
