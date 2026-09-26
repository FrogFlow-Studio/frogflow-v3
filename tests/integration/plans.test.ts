import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import { invalidateTenantDirectory, requireTenant } from "@/core/tenant/resolve.server";
import { effectiveModules } from "@/core/plans/plans";
import { nicheForVertical, parsePlan } from "@/core/plans/registry";
import { servedByV2 } from "@/core/tenant/directory";
import {
  extendTrial,
  getPlanView,
  setPlan,
  startTrial,
  toggleModuleOnPlan,
} from "@/app/operator/plans.server";

/**
 * Тариф на живой базе, только «Демо-тестер»: ключ плана пишется в
 * settings.billing.plan, в bots.subscription_plan — допустимый базой уровень,
 * флаги модулей пересчитываются, модуль сверх плана сохраняется бесплатно. Строка клиента возвращается как была.
 */
/** Автор записей журнала этого теста: по нему они и убираются. */
const ACTOR = "v2-plans-test";

let before: { modules: Json | null; subscription_plan: string | null; billing: Json | undefined };

async function tenant() {
  invalidateTenantDirectory();
  return requireTenant({ by: "id", value: DEMO_BOT });
}

async function dbPlan() {
  const { data } = await serviceDb()
    .from("bots")
    .select("subscription_plan")
    .eq("id", DEMO_BOT)
    .single();
  return data?.subscription_plan ?? null;
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
    // Журнал: свои записи и оставленные прежними прогонами под автором «test».
    await serviceDb()
      .from("bot_events")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .in("actor", [ACTOR, "test"]);
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
        setPlan(DEMO_BOT, { tier: "basic", period: "month", addons: [] }, ACTOR),
      ).rejects.toThrow(/после переезда/);
      expect((await tenant()).modules).toEqual(t0.modules);
      return;
    }

    await setPlan(DEMO_BOT, { tier: "basic", period: "month", addons: ["instagram"] }, ACTOR);
    const t1 = await tenant();
    expect(t1.plan).toBe(`${niche}.basic`);
    expect(t1.modules).toEqual(effectiveModules(parsePlan(t1.plan), { addons: ["instagram"] }));
    expect(t1.modules.instagram).toBe(true);
    expect(await dbPlan()).toBe("basic");

    await toggleModuleOnPlan(t1, "winback", true, ACTOR);
    const t2 = await tenant();
    expect(t2.modules.winback).toBe(true);
    expect(t2.settings.billing?.grandfathered).toContain("winback");
    await expect(toggleModuleOnPlan(t2, "shop", false, ACTOR)).rejects.toThrow(/входит в план/);

    const view = await getPlanView(DEMO_BOT);
    expect(view.usage.limits).toEqual({ aiDialogs: 300, receiptChecks: 200 });
    expect(view.outsidePlan).toEqual([]);

    // Business и индивидуальные условия: база принимает только free/basic/pro/enterprise.
    await setPlan(DEMO_BOT, { tier: "business", period: "month", addons: [] }, ACTOR);
    expect(await dbPlan()).toBe("enterprise");
    expect((await tenant()).plan).toBe(`${niche}.business`);
    await setPlan(DEMO_BOT, { tier: "custom", period: "month", addons: [] }, ACTOR);
    expect(await dbPlan()).toBe("enterprise");
    expect((await tenant()).plan).toBe("custom");
  });

  it("пробный период: 7 дней Basic нулевым платежом, продление — вплотную к сроку", async () => {
    const t0 = await tenant();
    if (!nicheForVertical(t0.vertical) || !servedByV2(t0)) return;
    const startedAt = new Date().toISOString();
    const { data: s0 } = await serviceDb()
      .from("bots")
      .select("settings")
      .eq("id", DEMO_BOT)
      .single();
    const billing = { ...((s0?.settings as { billing?: object }).billing ?? {}) };
    delete (billing as { trial_until?: string }).trial_until;
    await serviceDb()
      .from("bots")
      .update({ settings: { ...(s0?.settings as object), billing } as Json })
      .eq("id", DEMO_BOT);
    invalidateTenantDirectory();
    try {
      const { until } = await startTrial(DEMO_BOT, ACTOR);
      const t1 = await tenant();
      expect(t1.plan).toMatch(/\.basic$/);
      expect(t1.settings.billing?.trial_until).toBe(until);
      await expect(startTrial(DEMO_BOT, ACTOR)).rejects.toThrow(/уже был/);

      const { data: expires } = await serviceDb()
        .from("bots")
        .select("subscription_expires_at")
        .eq("id", DEMO_BOT)
        .single();
      if ((expires?.subscription_expires_at ?? "").slice(0, 10) > until) {
        // У демо-клиента оплачен срок дальше пробного — продлевать нечего.
        await expect(extendTrial(DEMO_BOT, 3, ACTOR)).rejects.toThrow(/уже оплатил/);
        return;
      }
      const r = await extendTrial(DEMO_BOT, 3, ACTOR);
      expect(r.until > until).toBe(true);
      expect((await tenant()).settings.billing?.trial_until).toBe(r.until);
      await expect(extendTrial(DEMO_BOT, 31, ACTOR)).rejects.toThrow(/1–30/);
    } finally {
      await serviceDb()
        .from("subscription_payments")
        .delete()
        .eq("bot_id", DEMO_BOT)
        .eq("amount", 0)
        .gte("paid_at", startedAt);
    }
  });
});
