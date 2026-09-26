import { describe, expect, it, vi } from "vitest";
import { availableModules, MODULE_KEYS, MODULES } from "@/core/modules/registry";
import { modulesFromJson } from "./directory";
import type { Tenant } from "./types";

vi.mock("@/config/env", () => ({
  env: () => ({ APP_URL: "https://x.invalid", SECRETS_KEY: "k", APP_TIMEZONE: "Asia/Almaty" }),
}));
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => ({}), tenantDb: () => ({}) }));

const planned = MODULE_KEYS.filter((k) => MODULES[k].status === "planned");

describe("модули «в разработке» ничего не открывают", () => {
  it("в каталоге есть planned-модули, среди них курсы", () => {
    expect(planned).toContain("courses");
  });

  it("availableModules снимает planned-флаги и оставляет готовые", () => {
    const all = modulesFromJson(Object.fromEntries(MODULE_KEYS.map((k) => [k, true])));
    const m = availableModules(all);
    for (const k of planned) expect(m[k], k).toBe(false);
    expect(m.shop).toBe(true);
    expect(m.upsell).toBe(MODULES.upsell.status === "available");
  });

  it("контекст клиента: courses=true в базе не открывает редактор уроков", async () => {
    const { tenantContext } = await import("./resolve.server");
    const raw = {
      id: "t",
      name: "Магазин",
      settings: {},
      modules: modulesFromJson({ shop: true, courses: true }),
    } as unknown as Tenant;
    const ctx = tenantContext(raw);
    expect(ctx.tenant.modules.courses).toBe(false);
    expect(ctx.tenant.modules.shop).toBe(true);
    // Сырые флаги справочника не тронуты — их видит проверка переезда у оператора.
    expect(raw.modules.courses).toBe(true);
  });
});
