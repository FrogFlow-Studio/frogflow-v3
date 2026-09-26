import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { resolvePrice } from "@/core/pricing/pricing";
import { OFFERS_KEY, offerForProduct, resetOffersCache } from "@/core/offers/offers";

/** Акция снижает цену в resolvePrice только при включённом модуле и в своё время. */
const PRODUCT = "00000000-0000-4000-8000-00000000abcd";
let ctx: TenantContext;
let prev: string | null = null;

describe.skipIf(!liveReady)("ограниченные предложения на демо-клиенте", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...t,
      modules: { ...t.modules, limited_offers: true, multi_currency: false },
    });
    prev = await getSetting(ctx, OFFERS_KEY);
  });
  afterAll(async () => {
    await setSetting(ctx, OFFERS_KEY, prev ?? "");
    resetOffersCache();
  });

  it("действующая акция режет цену, закончившаяся и выключенный модуль — нет", async () => {
    const now = Date.now();
    await setSetting(
      ctx,
      OFFERS_KEY,
      JSON.stringify([
        {
          id: "lo_test",
          product_id: PRODUCT,
          percent: 25,
          starts_at: new Date(now - 3600_000).toISOString(),
          ends_at: new Date(now + 3600_000).toISOString(),
          limit: 10,
        },
      ]),
    );
    resetOffersCache();
    const p = { id: PRODUCT, price: 2000, currency: "KZT" };
    expect(await resolvePrice(ctx, p, null)).toEqual({ amount: 1500, currency: "KZT" });
    expect((await offerForProduct(ctx, PRODUCT))?.left).toBe(10);

    const off = tenantContext({
      ...ctx.tenant,
      modules: { ...ctx.tenant.modules, limited_offers: false },
    });
    expect((await resolvePrice(off, p, null)).amount).toBe(2000);

    await setSetting(
      ctx,
      OFFERS_KEY,
      JSON.stringify([
        {
          id: "lo_old",
          product_id: PRODUCT,
          percent: 25,
          starts_at: new Date(now - 7200_000).toISOString(),
          ends_at: new Date(now - 3600_000).toISOString(),
          limit: null,
        },
      ]),
    );
    resetOffersCache();
    expect((await resolvePrice(ctx, p, null)).amount).toBe(2000);
  });
});
