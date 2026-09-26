import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer, upsertCustomer, userKey } from "@/core/customers/customers";
import { countWaiting, joinWaitlist, notifyWaitlist } from "@/core/waitlist/waitlist";

/** Лист ожидания на демо-клиенте: подписка в состоянии, выборка по jsonb, рассылка снимает подписку. */
const TG = TEST_TG_ID + 91;
const KEY = userKey("telegram", String(TG));
let ctx: TenantContext;
let productId = "";

async function cleanup() {
  const db = serviceDb();
  await db.from("bot_users").delete().eq("bot_id", DEMO_BOT).eq("user_key", KEY);
  if (productId) await db.from("products").delete().eq("id", productId);
}

describe.skipIf(!liveReady)("лист ожидания на демо-клиенте", () => {
  beforeAll(async () => {
    ctx = tenantContext(await requireTenant({ by: "id", value: DEMO_BOT }));
    const { data, error } = await ctx.db
      .from("products")
      .insert({
        bot_id: DEMO_BOT,
        name: "v2 waitlist · проба",
        price: 100,
        currency: "KZT",
        is_active: true,
        stock_quantity: 0,
        fulfillment_kind: "physical",
        category_ids: [],
        country_prices: {},
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message);
    productId = data.id;
  });
  afterAll(cleanup);

  it("подписка без дублей, рассылка снимает её только у тех, кому ушло", async () => {
    let c = await upsertCustomer(ctx, "telegram", String(TG), { firstName: "Ждун" });
    c = await joinWaitlist(ctx, c, productId);
    c = await joinWaitlist(ctx, c, productId);
    expect(c.state.waitlist).toEqual([productId]);
    expect(await countWaiting(ctx, productId)).toBe(1);

    const failed = await notifyWaitlist(ctx, productId, async () => false);
    expect(failed).toEqual({ notified: 0, failed: 1 });
    expect(await countWaiting(ctx, productId)).toBe(1);

    const sentTo: number[] = [];
    const ok = await notifyWaitlist(ctx, productId, async (x) => {
      sentTo.push(x.telegramId);
      return true;
    });
    expect(ok).toEqual({ notified: 1, failed: 0 });
    expect(sentTo).toEqual([TG]);
    expect(await countWaiting(ctx, productId)).toBe(0);
    expect((await getCustomer(ctx, KEY))?.state.waitlist).toEqual([]);
  });
});
