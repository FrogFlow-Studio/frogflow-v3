import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer, upsertCustomer, userKey } from "@/core/customers/customers";
import { getSetting, setSetting } from "@/core/settings/settings";
import { FUNNEL_KEY, runFunnel } from "@/core/funnel/funnel";

/** Автоворонка: новичок получает наступивший шаг один раз; покупатель выходит из серии. */
const TG = TEST_TG_ID + 95;
const KEY = userKey("telegram", String(TG));
let ctx: TenantContext;
let prev: string | null = null;

async function cleanup() {
  const db = serviceDb();
  await db.from("orders").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db.from("bot_users").delete().eq("bot_id", DEMO_BOT).eq("user_key", KEY);
}

describe.skipIf(!liveReady)("автоворонка на демо-клиенте", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({ ...t, modules: { ...t.modules, funnel: true } });
    prev = await getSetting(ctx, FUNNEL_KEY);
    await cleanup();
    await upsertCustomer(ctx, "telegram", String(TG), { firstName: "Новичок" });
    await serviceDb()
      .from("bot_users")
      .update({ created_at: new Date(Date.now() - 30 * 3600_000).toISOString() })
      .eq("bot_id", DEMO_BOT)
      .eq("user_key", KEY);
  });
  afterAll(async () => {
    await setSetting(ctx, FUNNEL_KEY, prev ?? "");
    await cleanup();
  });

  it("шаг «через сутки» уходит один раз; после заказа серия останавливается", async () => {
    await setSetting(
      ctx,
      FUNNEL_KEY,
      JSON.stringify({
        enabled: true,
        stopOnOrder: true,
        steps: [
          { afterHours: 1, text: "{name}, привет" },
          { afterHours: 24, text: "{name}, сутки спустя" },
          { afterHours: 72, text: "третий день" },
        ],
      }),
    );
    const day = new Date();
    day.setUTCHours(6, 0, 0, 0);
    const sent: string[] = [];
    const send = async (c: { telegramId: number }, text: string) => {
      if (c.telegramId === TG) sent.push(text);
      return true;
    };
    await runFunnel(ctx, send, day);
    await runFunnel(ctx, send, day);
    expect(sent).toEqual(["Новичок, сутки спустя"]);
    expect((await getCustomer(ctx, KEY))?.state.funnel).toMatchObject({ step: 2 });

    await serviceDb().from("orders").insert({
      bot_id: DEMO_BOT,
      telegram_id: TG,
      status: "delivered",
      total: 1,
      currency: "KZT",
      platform: "telegram",
      display_name: "Новичок",
    });
    await runFunnel(ctx, send, new Date(day.getTime() + 3 * 86_400_000));
    expect(sent).toHaveLength(1);
    expect((await getCustomer(ctx, KEY))?.state.funnel).toMatchObject({ stopped: true });
  });
});
