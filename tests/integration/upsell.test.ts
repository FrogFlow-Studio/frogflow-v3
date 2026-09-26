import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { UPSELL_KEY, setUpsellFor, upsellFor } from "@/core/upsell/upsell";

/** Апсейл: правило продавца первым, без распроданного и без того, что уже в корзине. */
let ctx: TenantContext;
let prev: string | null = null;
const ids: string[] = [];

async function product(name: string, stock: number | null) {
  const { data, error } = await ctx.db
    .from("products")
    .insert({
      bot_id: DEMO_BOT,
      name,
      price: 500,
      currency: "KZT",
      is_active: true,
      stock_quantity: stock,
      fulfillment_kind: "physical",
      category_ids: [],
      country_prices: {},
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message);
  ids.push(data.id);
  return data.id;
}

describe.skipIf(!liveReady)("апсейл на демо-клиенте", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({ ...t, modules: { ...t.modules, upsell: true, stock: true } });
    prev = await getSetting(ctx, UPSELL_KEY);
  });
  afterAll(async () => {
    await setSetting(ctx, UPSELL_KEY, prev ?? "");
    if (ids.length) await serviceDb().from("products").delete().in("id", ids);
  });

  it("правило продавца, минус распроданное и лежащее в корзине", async () => {
    const main = await product("v2 upsell · основной", null);
    const extra = await product("v2 upsell · к нему", null);
    const soldOut = await product("v2 upsell · распродан", 0);
    await setUpsellFor(ctx, main, [soldOut, extra, main]);
    const r = await upsellFor(ctx, [main]);
    expect(r.map((x) => x.id)).toEqual([extra]);
    expect(await upsellFor(ctx, [main, extra])).toEqual([]);
    const off = tenantContext({ ...ctx.tenant, modules: { ...ctx.tenant.modules, upsell: false } });
    expect(await upsellFor(off, [main])).toEqual([]);
  });
});
