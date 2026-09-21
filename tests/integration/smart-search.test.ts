import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer, upsertCustomer, userKey } from "@/core/customers/customers";
import { getSetting, setSetting } from "@/core/settings/settings";
import { consumeQuota, KEYS, smartSearchEnabled } from "@/core/search/smart.server";
import { parseDailyCount } from "@/core/search/smart-pure";

const TG = TEST_TG_ID + 50;
let ctx: TenantContext;
let prevCount: string | null = null;

async function cleanup() {
  await serviceDb()
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", userKey("telegram", TG));
}

describe.skipIf(!liveReady)("умный поиск: предохранители на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({ ...tenant, modules: { ...tenant.modules, smart_search: true } });
    await cleanup();
    prevCount = await getSetting(ctx, KEYS.dailyCount);
    await setSetting(ctx, KEYS.dailyCount, "");
  });
  afterAll(async () => {
    await cleanup();
    await setSetting(ctx, KEYS.dailyCount, prevCount ?? "");
  });

  it("без переключателя продавца поиск выключен", async () => {
    const prev = await getSetting(ctx, KEYS.enabled);
    await setSetting(ctx, KEYS.enabled, "false");
    expect(await smartSearchEnabled(ctx)).toBe(false);
    await setSetting(ctx, KEYS.enabled, prev ?? "");
  });

  it("кулдаун покупателя и дневной счётчик", async () => {
    const c = await upsertCustomer(ctx, "telegram", TG, { firstName: "Поиск" });
    expect(await consumeQuota(ctx, c)).toBe(true);
    expect(parseDailyCount(await getSetting(ctx, KEYS.dailyCount))).toBe(1);
    const again = (await getCustomer(ctx, c.userKey))!;
    expect(typeof again.state.last_smart_search_at).toBe("string");
    expect(await consumeQuota(ctx, again)).toBe(false); // 45 секунд не прошло
    expect(parseDailyCount(await getSetting(ctx, KEYS.dailyCount))).toBe(1);
  });
});
