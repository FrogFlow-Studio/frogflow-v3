import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, OTHER_BOT } from "./live";
import { serviceDb, tenantDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer, userKey } from "@/core/customers/customers";
import { claimOrderPlacement, releaseOrderPlacement } from "@/core/orders/orders";
import { activeDeliveryZones } from "@/core/fulfillment/fulfillment";

/**
 * Живые пункты описи по заказу и доставке, которые фейковая база не
 * моделирует: атомарность SQL-функции claim_order_placement и RLS на
 * delivery_zones. Пишем только в «Демо-тестер» и убираем за собой; к
 * настоящему клиенту (OTHER_BOT) — только чтение, которое обязано вернуть пусто.
 */
const CLAIM_TG_ID = 990000002; // свой синтетический покупатель, не пересекается с shop-flow
const ZONE_NAME = "v2 probe · зона доставки";

let ctx: TenantContext;

async function cleanup() {
  const db = serviceDb();
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", userKey("telegram", CLAIM_TG_ID));
  await db.from("delivery_zones").delete().eq("bot_id", DEMO_BOT).eq("name", ZONE_NAME);
}

describe.skipIf(!liveReady)("живая база: захват оформления и зоны доставки", () => {
  beforeAll(async () => {
    ctx = tenantContext(await requireTenant({ by: "id", value: DEMO_BOT }));
    await cleanup();
  });
  afterAll(cleanup);

  it("из двух одновременных попыток claim забирает ровно одна", async () => {
    const customer = await upsertCustomer(ctx, "telegram", CLAIM_TG_ID, {
      firstName: "v2 probe",
    });
    // Два одновременных «Оформить» (двойной тап) и затем залп из пяти.
    const pair = await Promise.all([
      claimOrderPlacement(ctx, customer),
      claimOrderPlacement(ctx, customer),
    ]);
    expect(pair.filter(Boolean)).toHaveLength(1);
    await releaseOrderPlacement(ctx, customer, {});

    const burst = await Promise.all(
      Array.from({ length: 5 }, () => claimOrderPlacement(ctx, customer)),
    );
    expect(burst.filter(Boolean)).toHaveLength(1);
    await releaseOrderPlacement(ctx, customer, {});
  });

  it("activeDeliveryZones не видит зоны другого арендатора (RLS-изоляция)", async () => {
    const { error } = await ctx.db.from("delivery_zones").insert({
      bot_id: DEMO_BOT,
      name: ZONE_NAME,
      price: 1500,
      sort_order: 999,
      is_active: true,
    });
    expect(error).toBeNull();

    const zones = await activeDeliveryZones(ctx);
    expect(zones.some((z) => z.name === ZONE_NAME)).toBe(true);

    // Всё, что вернулось, — зоны демо-клиента: сверяем со справочником под сервисным ключом.
    const { data: own } = await serviceDb()
      .from("delivery_zones")
      .select("id")
      .eq("bot_id", DEMO_BOT)
      .eq("is_active", true);
    expect(zones.map((z) => z.id).sort()).toEqual((own ?? []).map((z) => z.id).sort());

    // Зоны настоящего клиента (только чтение) в выдачу не попадают.
    const { data: foreign } = await serviceDb()
      .from("delivery_zones")
      .select("id")
      .eq("bot_id", OTHER_BOT);
    const foreignIds = new Set((foreign ?? []).map((z) => z.id));
    expect(zones.filter((z) => foreignIds.has(z.id))).toEqual([]);

    // Прямой запрос под ключом демо с фильтром на чужой bot_id — пусто.
    const direct = await tenantDb(DEMO_BOT)
      .from("delivery_zones")
      .select("id")
      .eq("bot_id", OTHER_BOT)
      .limit(5);
    expect(direct.data ?? []).toEqual([]);
  });
});
