import { describe, expect, it, vi } from "vitest";
import { availableModules, moduleDef, MODULE_KEYS, MODULES } from "@/core/modules/registry";
import { modulesFromJson } from "./directory";
import type { Tenant } from "./types";

vi.mock("@/config/env", () => ({
  env: () => ({ APP_URL: "https://x.invalid", SECRETS_KEY: "k", APP_TIMEZONE: "Asia/Almaty" }),
}));
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => ({}), tenantDb: () => ({}) }));

// «В разработке» — механизм на будущие позиции прайса; сейчас таких может не быть.
const planned = MODULE_KEYS.filter((k) => moduleDef(k).status === "planned");

describe("модули «в разработке» ничего не открывают", () => {
  it("курсы и крипта готовы и в число planned не входят", () => {
    expect(planned).not.toContain("courses");
    expect(planned).not.toContain("crypto");
  });

  it("availableModules снимает planned-флаги и оставляет готовые", () => {
    const all = modulesFromJson(Object.fromEntries(MODULE_KEYS.map((k) => [k, true])));
    const m = availableModules(all);
    for (const k of planned) expect(m[k], k).toBe(false);
    expect(m.shop).toBe(true);
    expect(m.upsell).toBe(MODULES.upsell.status === "available");
  });

  it("контекст клиента: planned-флаг в базе ничего не открывает, готовый — открывает", async () => {
    const { tenantContext } = await import("./resolve.server");
    const flags = Object.fromEntries(MODULE_KEYS.map((k) => [k, true]));
    const raw = {
      id: "t",
      name: "Магазин",
      settings: {},
      modules: modulesFromJson(flags),
    } as unknown as Tenant;
    const ctx = tenantContext(raw);
    for (const k of MODULE_KEYS)
      expect(ctx.tenant.modules[k], k).toBe(moduleDef(k).status === "available");
    expect(ctx.tenant.modules.crypto).toBe(true);
    // Сырые флаги справочника не тронуты — их видит проверка переезда у оператора.
    expect(raw.modules.crypto).toBe(true);
  });
});
