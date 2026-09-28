import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_KEYS } from "@/core/modules/registry";
import { planModules } from "@/core/plans/plans";
import { tenantFromRow, type TenantRow } from "@/core/tenant/directory";

/**
 * Оператор и модули клиента на плане. Модули клиента v2 на плане справочник
 * выводит из плана (core/tenant/directory), поэтому здесь проверяется, что
 * это не обходит запреты панели: модуль из плана выключается только сменой
 * плана, сверх плана — через «сохранённые» (billing.grandfathered).
 */
let row: TenantRow;

function patch(target: Record<string, unknown>, p: Record<string, unknown>) {
  for (const [k, v] of Object.entries(p)) {
    const prev = target[k];
    target[k] =
      v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object"
        ? { ...(prev as object), ...(v as object) }
        : v;
  }
}

vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => [tenantFromRow(row)],
  invalidateTenantDirectory: () => {},
  patchTenantSettings: async (_id: string, p: Record<string, unknown>) =>
    patch(row.settings as Record<string, unknown>, p),
}));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    from: () => ({
      update: (v: { modules?: unknown }) => ({
        eq: async () => {
          if (v.modules) row = { ...row, modules: v.modules as TenantRow["modules"] };
          return { error: null };
        },
      }),
    }),
  }),
}));
vi.mock("./operator.server", () => ({ logEvent: async () => {} }));

const { adoptSuggestedPlan, setPlan, startTrial, toggleModuleOnPlan } =
  await import("./plans.server");
vi.mock("./billing.server", () => ({ addPayment: async () => {} }));

function client(
  plan: string | null,
  modules: Record<string, boolean> = { shop: true, courses: false },
) {
  row = {
    id: "b",
    bot_name: "Магазин",
    status: "active",
    vertical: "digital",
    // Флаги записаны, когда курсы были «в разработке».
    modules,
    settings: { served_by: "v2", billing: plan ? { plan } : {} },
    paused_message: null,
    owner_telegram_id: null,
    app_url: null,
    archived_at: null,
    bot_token: null,
  } as unknown as TenantRow;
}
const current = () => tenantFromRow(row);

describe("оператор и модули клиента на плане", () => {
  beforeEach(() => client("digital.pro"));

  it("модуль из плана выключить нельзя — и вывод из плана этого не обходит", async () => {
    expect(current().modules.courses).toBe(true);
    await expect(toggleModuleOnPlan(current(), "courses", false, "op")).rejects.toThrow(
      /смените план/,
    );
    expect(current().modules.courses).toBe(true);
  });

  it("сверх плана: включение и выключение через сохранённые", async () => {
    client("digital.basic");
    expect(current().modules.courses).toBe(false);
    await toggleModuleOnPlan(current(), "courses", true, "op");
    expect(current().settings.billing?.grandfathered).toContain("courses");
    expect(current().modules.courses).toBe(true);
    await toggleModuleOnPlan(current(), "courses", false, "op");
    expect(current().settings.billing?.grandfathered).not.toContain("courses");
    expect(current().modules.courses).toBe(false);
  });

  it("модуль «в разработке» не включается и сверх плана", async () => {
    await expect(toggleModuleOnPlan(current(), "kaspi_pay", true, "op")).rejects.toThrow(
      /не реализован/,
    );
    expect(current().modules.kaspi_pay).toBe(false);
  });
});

describe("любое назначение плана сохраняет купленное сверх него", () => {
  const bought = { shop: true, instagram: true, whatsapp: true, wa_shop: true, referral: true };
  const kept = () => current().settings.billing?.grandfathered ?? [];

  it("выбор плана оператором (в том числе тот же план)", async () => {
    client("digital.pro", bought);
    await setPlan("b", { tier: "pro", period: "month", addons: [] }, "op");
    expect(kept()).toEqual(expect.arrayContaining(["instagram", "wa_shop", "referral"]));
    expect(row.modules).toMatchObject({ instagram: true, wa_shop: true, referral: true });
  });

  it("первый план после переезда и пробный период", async () => {
    client(null, bought);
    await setPlan("b", { tier: "basic", period: "month", addons: [] }, "op");
    expect(kept()).toEqual(expect.arrayContaining(["instagram", "wa_shop", "referral"]));
    client(null, bought);
    await startTrial("b", "op");
    expect(kept()).toEqual(expect.arrayContaining(["instagram", "wa_shop", "referral"]));
    expect(current().modules.instagram).toBe(true);
  });

  it("переход на подобранный план", async () => {
    client(null, bought);
    await adoptSuggestedPlan("b", "op");
    expect(current().modules).toMatchObject({ instagram: true, wa_shop: true, referral: true });
  });

  it("понижение плана выключает модули прежнего плана, но не купленные", async () => {
    client("digital.pro", bought);
    const proOnly = MODULE_KEYS.find(
      (k) => planModules("digital", "pro").has(k) && !planModules("digital", "basic").has(k),
    )!;
    row = { ...row, modules: { ...bought, [proOnly]: true } };
    await setPlan("b", { tier: "basic", period: "month", addons: [] }, "op");
    expect(current().modules[proOnly]).toBe(false);
    expect(current().modules.instagram).toBe(true);
  });
});
