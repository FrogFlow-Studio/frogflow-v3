import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";

/**
 * Запросы к Zernio при привязке вебхука v2: пишется только своя запись,
 * запись v1 с тем же ключом не меняется и не удаляется, а проверка
 * состояния (крон) ничего не пишет.
 */
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => [
    { id: "a", settings: { served_by: "v2", zernio: { profile_id: "p-a" } } },
    { id: "b", settings: { served_by: "v2", zernio: { profile_id: "p-b" } } },
    { id: "old", settings: { served_by: "v1", zernio: { profile_id: "p-v1" } } },
  ],
  patchTenantSettings: async () => undefined,
  requireTenant: async () => null,
}));

const V1 = {
  _id: "v1-store",
  name: "FrogFlow Store Webhook",
  url: "https://aatech-pi.vercel.app/api/public/zernio/webhook",
  events: ["message.received", "comment.received"],
  isActive: true,
};

function zernio(webhooks: unknown[]) {
  const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: new URL(url).pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json(method === "GET" ? { webhooks } : { success: true });
    }),
  );
  return calls;
}

afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

const ENV = {
  ZERNIO_API_KEY: "sk_test",
  ZERNIO_WEBHOOK_SECRET: "whsec",
  APP_URL: "https://www.frogflow.tech",
};

describe("вебхук v2 в Zernio: запросы", () => {
  it("кнопка оператора: запись v1 остаётся как была, создаётся своя с профилями клиентов v2", async () => {
    setEnvForTests(ENV);
    const calls = zernio([V1]);
    const { syncV2Webhook } = await import("./connect.server");
    const r = await syncV2Webhook();
    expect(r).toMatchObject({ ok: true, action: "create", profiles: 2 });
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      body: {
        url: "https://www.frogflow.tech/api/zernio/webhook",
        profileIds: ["p-a", "p-b"],
        secret: "whsec",
      },
    });
    expect(JSON.stringify(calls)).not.toContain("v1-store");
  });

  it("своя запись обновляется по своему id, запись v1 не трогается", async () => {
    setEnvForTests(ENV);
    const own = {
      _id: "own",
      name: "FrogFlow v2",
      url: "https://www.frogflow.tech/api/zernio/webhook",
      events: ["message.received"],
      isActive: true,
      profileIds: ["p-a"],
    };
    const calls = zernio([V1, own]);
    const { syncV2Webhook } = await import("./connect.server");
    await syncV2Webhook();
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => [c.method, c.body?.webhookId])).toEqual([["PUT", "own"]]);
    expect(writes[0]!.body).toMatchObject({ profileIds: ["p-a", "p-b"], isActive: true });
    expect(JSON.stringify(calls)).not.toContain("v1-store");
  });

  it("проверка состояния (крон) только читает", async () => {
    setEnvForTests(ENV);
    const calls = zernio([V1]);
    const { v2WebhookStatus } = await import("./connect.server");
    const r = await v2WebhookStatus();
    expect(r).toMatchObject({ ok: false, action: "create", foreign: [{ url: V1.url }] });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
});
