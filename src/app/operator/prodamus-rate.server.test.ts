import { beforeEach, describe, expect, it, vi } from "vitest";

const tenant = { id: "b1", settings: { served_by: "v2" } };
const saved: Record<string, string> = {};
const events: unknown[] = [];

vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: vi.fn(async () => tenant),
  tenantContext: vi.fn(() => ({ tenant })),
}));
vi.mock("@/core/tenant/directory", () => ({
  servedByV2: (t: { settings: { served_by?: string } }) => t.settings.served_by === "v2",
}));
vi.mock("@/core/settings/settings", () => ({
  setSetting: vi.fn(async (_ctx: unknown, k: string, v: string) => {
    saved[k] = v;
  }),
  getSettingsStrict: vi.fn(async () => ({ ...saved, prodamus_enabled: "true" })),
}));
vi.mock("./client-log.server", () => ({
  logEvent: vi.fn(async (...a: unknown[]) => void events.push(a)),
}));

const { setProdamusRate, prodamusRateState } = await import("./prodamus-rate.server");

describe("курс Продамуса из карточки клиента", () => {
  beforeEach(() => {
    for (const k of Object.keys(saved)) delete saved[k];
    events.length = 0;
    tenant.settings.served_by = "v2";
  });

  it("запятая становится точкой, курс виден в состоянии и в журнале", async () => {
    await setProdamusRate("b1", " 3,573 ", "yakov");
    expect(saved.prodamus_rate).toBe("3.573");
    expect((await prodamusRateState("b1")).rate).toBe("3.573");
    expect(events).toHaveLength(1);
  });

  it("не число и ноль не сохраняются", async () => {
    await expect(setProdamusRate("b1", "abc", "yakov")).rejects.toThrow();
    await expect(setProdamusRate("b1", "0", "yakov")).rejects.toThrow();
    expect(saved.prodamus_rate).toBeUndefined();
  });

  it("клиента v1 не трогает", async () => {
    tenant.settings.served_by = "v1";
    await expect(setProdamusRate("b1", "3.5", "yakov")).rejects.toThrow();
    expect(saved.prodamus_rate).toBeUndefined();
  });
});
