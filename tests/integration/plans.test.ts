import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import { invalidateTenantDirectory, requireTenant } from "@/core/tenant/resolve.server";
import { effectiveModules } from "@/core/plans/plans";
import { nicheForVertical, parsePlan } from "@/core/plans/registry";
import { servedByV2 } from "@/core/tenant/directory";
import { setPlan, toggleModuleOnPlan, getPlanView } from "@/app/operator/plans.server";

/**
 * Тариф на живой базе, только «Демо-тестер»: план пишется в
 * bots.subscription_plan, флаги модулей пересчитываются, модуль сверх плана
 * сохраняется бесплатно. Строка клиента возвращается как была.
 */
let before: { modules: Json | null; subscription_plan: string | null; billing: Json | undefined };

async function tenant() {
  invalidateTenantDirectory();
  return requireTenant({ by: "id", value: DEMO_BOT });
}

describe.skipIf(!liveReady)("тарифы на демо-клиенте", () => {
  beforeAll(async () => {
    const { data } = await serviceDb()
      .from("bots")
      .select("modules, subscription_plan, settings")
      .eq("id", DEMO_BOT)
      .single();
    before = {
      modules: data?.modules ?? null,
      subscription_plan: data?.subscription_plan ?? null,
      billing: (data?.settings as { billing?: Json } | null)?.billing,
    };
  });

  afterAll(async () => {
    const { data } = await serviceDb().from("bots").select("settings").eq("id", DEMO_BOT).single();
    const settings = { ...(data?.settings as Record<string, unknown>), billing: before.billing };
    await serviceDb()
      .from("bots")
      .update({
        modules: before.modules,
        subscription_plan: before.subscription_plan,
        settings: settings as Json,
      })
      .eq("id", DEMO_BOT);
    invalidateTenantDirectory();
  });

  it("план пересчитывает модули, модуль сверх плана сохраняется, выключить модуль плана нельзя", async () => {
    const t0 = await tenant();
    const niche = nicheForVertical(t0.vertical);
    if (!niche) return; // у демо-клиента ниша без тарифов — проверять нечего
    if (!servedByV2(t0)) {
      // Демо-клиент ещё на v1: план не назначается, модули не трогаются.
      await expect(
        setPlan(DEMO_BOT, { tier: "basic", period: "month", addons: [] }, "test"),
      ).rejects.toThrow(/после переезда/);
      expect((await tenant()).modules).toEqual(t0.modules);
      return;
    }

    await setPlan(DEMO_BOT, { tier: "basic", period: "month", addons: ["instagram"] }, "test");
    const t1 = await tenant();
    expect(t1.plan).toBe(`${niche}.basic`);
    expect(t1.modules).toEqual(effectiveModules(parsePlan(t1.plan), { addons: ["instagram"] }));
    expect(t1.modules.instagram).toBe(true);

    await toggleModuleOnPlan(t1, "winback", true, "test");
    const t2 = await tenant();
    expect(t2.modules.winback).toBe(true);
    expect(t2.settings.billing?.grandfathered).toContain("winback");
    await expect(toggleModuleOnPlan(t2, "shop", false, "test")).rejects.toThrow(/входит в план/);

    const view = await getPlanView(DEMO_BOT);
    expect(view.usage.limits).toEqual({ aiDialogs: 300, receiptChecks: 200 });
    expect(view.outsidePlan).toEqual([]);
  });
});
