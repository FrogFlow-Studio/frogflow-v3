import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { recordOrderEvent } from "@/core/orders/events";
import { CRM_KEY } from "@/core/crm/webhook";
import { OUTBOX_PREFIX, processOutbox, type OutboxMessage } from "@/core/outbox/outbox";

/** Событие заказа → очередь → вебхук продавца; выключенное событие не уходит. */
let ctx: TenantContext;
let prev: string | null = null;
let orderId = 0;
const started = new Date().toISOString();

describe.skipIf(!liveReady)("интеграция с CRM на демо-клиенте", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({ ...t, modules: { ...t.modules, crm_integration: true } });
    prev = await getSetting(ctx, CRM_KEY);
    await setSetting(
      ctx,
      CRM_KEY,
      JSON.stringify({ url: "https://crm.example.com/hook", secret: "s", events: ["placed"] }),
    );
    const { data, error } = await serviceDb()
      .from("orders")
      .insert({
        bot_id: DEMO_BOT,
        telegram_id: TEST_TG_ID + 99,
        status: "awaiting_payment",
        total: 777,
        currency: "KZT",
        platform: "telegram",
        display_name: "CRM проба",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message);
    orderId = data.id;
  });
  afterAll(async () => {
    await setSetting(ctx, CRM_KEY, prev ?? "");
    const db = serviceDb();
    await db
      .from("zernio_logs")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .like("event_id", `order:${orderId}:%`);
    await db
      .from("zernio_logs")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .like("event_id", `${OUTBOX_PREFIX}%`)
      .gte("created_at", started);
    await db.from("orders").delete().eq("id", orderId);
  });

  it("placed уходит в очередь с заказом в теле, rejected (не выбран) — нет", async () => {
    await recordOrderEvent(ctx, orderId, "placed");
    await recordOrderEvent(ctx, orderId, "rejected");
    const got: OutboxMessage[] = [];
    const r = await processOutbox(ctx, async (_c, m) => {
      if (m.orderId === orderId) got.push(m);
      return { ok: true };
    });
    expect(r.tried).toBeGreaterThanOrEqual(1);
    expect(got).toHaveLength(1);
    expect(got[0]!.target).toEqual({ channel: "webhook", url: "https://crm.example.com/hook" });
    const body = JSON.parse(got[0]!.text!);
    expect(body.event).toBe("order.placed");
    expect(body.order).toMatchObject({ id: orderId, total: 777, customer: "CRM проба" });
  });
});
