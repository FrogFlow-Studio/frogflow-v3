import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Переезд VIP-клиента (Дидактика): при переключении на v2 вебхук VIP-бота
 * встаёт сразу, а не кроном в начале часа; без модуля или токена его не трогаем.
 */
type T = {
  id: string;
  modules: Record<string, boolean>;
  settings: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
let tenant: T;
const vipCalls: Array<{ servedBy: unknown; force: boolean }> = [];
const events: unknown[] = [];
let vipResult: { ok: boolean; url: string | null; pending: number; error?: string } | Error;

vi.mock("./migration.server", () => ({ preflight: async () => ({ ready: true, checks: [] }) }));
vi.mock("./client-log.server", () => ({
  logEvent: async (...a: unknown[]) => void events.push(a),
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: async () => tenant,
  patchTenantSettings: async (_id: string, patch: Record<string, unknown>) => {
    tenant = { ...tenant, settings: { ...tenant.settings, ...patch } };
  },
  tenantContext: (t: unknown) => ({ tenant: t }),
  tenantDirectory: async () => [tenant],
  invalidateTenantDirectory: () => {},
}));
vi.mock("@/channels/telegram/webhook-setup.server", () => ({
  ensureTelegramWebhook: async () => ({ ok: true, url: "https://v3/api/telegram/b", pending: 0 }),
  releaseTelegramToV1: async () => {},
}));
vi.mock("@/channels/telegram/vip-webhook-setup.server", () => ({
  ensureVipWebhook: async (t: T, force: boolean) => {
    vipCalls.push({ servedBy: t.settings.served_by, force });
    if (vipResult instanceof Error) throw vipResult;
    return vipResult;
  },
}));
vi.mock("./story-tags-import.server", () => ({
  planLegacyStoryTags: async () => ({ add: 0, dropped: 0, merged: [] }),
  storyTagsNote: () => null,
}));
vi.mock("@/channels/zernio/ice-breakers.server", () => ({
  refreshIceBreakers: async () => ({ ok: true }),
  releaseIceBreakersToV1: async () => {},
}));

const { setServedBy } = await import("./client-settings.server");

beforeEach(() => {
  vipCalls.length = 0;
  events.length = 0;
  vipResult = { ok: true, url: "https://v3/api/telegram/b/vip", pending: 0 };
  tenant = {
    id: "b",
    modules: { vip: true, shop: true },
    settings: { vip: { token_enc: "enc", username: "did_vip_bot" } },
  };
});

describe("переезд VIP-клиента", () => {
  it("вебхук VIP-бота переставляется сразу, уже клиенту на v2", async () => {
    const r = await setServedBy("b", "v2", "op");
    expect(vipCalls).toEqual([{ servedBy: "v2", force: true }]);
    expect(r?.vip).toEqual({ ok: true, url: "https://v3/api/telegram/b/vip", pending: 0 });
    expect(events).toContainEqual([
      "b",
      "webhook",
      { action: "vip_set", ok: true, url: "https://v3/api/telegram/b/vip", pending: 0 },
      "op",
    ]);
  });

  it("сбой Telegram не срывает переезд: ошибка видна в ответе", async () => {
    vipResult = new Error("fetch failed");
    const r = await setServedBy("b", "v2", "op");
    expect(tenant.settings.served_by).toBe("v2");
    expect(r?.vip).toMatchObject({ ok: false, error: "Error: fetch failed" });
  });

  it("без токена VIP или без модуля — вебхук VIP не трогаем", async () => {
    tenant.settings = {};
    expect((await setServedBy("b", "v2", "op"))?.vip).toBeNull();
    tenant = { ...tenant, modules: { shop: true }, settings: { vip: { token_enc: "enc" } } };
    expect((await setServedBy("b", "v2", "op"))?.vip).toBeNull();
    expect(vipCalls).toEqual([]);
  });

  it("откат на v1 вебхук VIP не переставляет", async () => {
    tenant.settings.served_by = "v2";
    await setServedBy("b", "v1", "op");
    expect(vipCalls).toEqual([]);
  });
});
