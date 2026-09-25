import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer, userKey, type Customer } from "@/core/customers/customers";
import { addToCart } from "@/core/cart/cart";
import {
  attachPaymentProof,
  deliverOrder,
  getOrder,
  placeOrder,
  rejectOrder,
} from "@/core/orders/orders";
import { listOrderEvents } from "@/core/orders/events";

/** Таймлайн заказа: создан, чек, выдача позиций, сбой и завершение — всё в журнале. */
const TG = TEST_TG_ID + 70;
const PROBE_NAME = "v2 events · материал";
const COUNTRY_NAME = "Казахстан (v2 events)";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 7, 7, 7]);
let ctx: TenantContext;
let customer: Customer;
let productId = "";
const orders: number[] = [];

async function cleanup() {
  const db = serviceDb();
  for (const id of orders) {
    const { data: files } = await db.storage.from("payment-proofs").list(`${DEMO_BOT}/order-${id}`);
    if (files?.length)
      await db.storage
        .from("payment-proofs")
        .remove(files.map((f) => `${DEMO_BOT}/order-${id}/${f.name}`));
    await db.from("zernio_logs").delete().eq("bot_id", DEMO_BOT).like("event_id", `order:${id}:%`);
    await db.from("orders").delete().eq("id", id);
  }
  await db.from("cart_items").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", userKey("telegram", TG));
  await db.from("products").delete().eq("bot_id", DEMO_BOT).eq("name", PROBE_NAME);
  await db.from("payment_methods").delete().eq("bot_id", DEMO_BOT).eq("country_name", COUNTRY_NAME);
}

describe.skipIf(!liveReady)("таймлайн заказа на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: {
        ...tenant.modules,
        multi_language: false,
        stock: false,
        loyalty: false,
        referral: false,
      },
    });
    await cleanup();
    const { data: p, error } = await ctx.db
      .from("products")
      .insert({
        bot_id: DEMO_BOT,
        name: PROBE_NAME,
        price: 700,
        currency: "KZT",
        is_active: true,
        fulfillment_kind: "digital",
        category_ids: [],
        country_prices: {},
        file_url: "https://example.com/material.pdf",
      })
      .select("id")
      .single();
    if (error || !p) throw new Error(`seed product: ${error?.message}`);
    productId = p.id;
    await ctx.db.from("payment_methods").insert({
      bot_id: DEMO_BOT,
      country_code: "KZ",
      country_name: COUNTRY_NAME,
      instructions: "тест",
      currency: "KZT",
      is_active: true,
      sort_order: 97,
    });
    customer = await upsertCustomer(ctx, "telegram", TG, { firstName: "События" });
  });
  afterAll(cleanup);

  it("создан → чек → сбой выдачи → выдача продавцом: каждая веха в журнале", async () => {
    expect(await addToCart(ctx, customer, productId)).toBe("ok");
    const r = await placeOrder(ctx, customer, "KZ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    orders.push(r.order.id);
    const proof = await attachPaymentProof(ctx, r.order.id, {
      bytes: PNG,
      mime: "image/png",
      ext: "png",
    });
    expect(proof.ok).toBe(true);

    // Канал не доставил — заказ возвращается на подтверждение, сбой в журнале.
    const failing = await deliverOrder(ctx, r.order.id, async () => "failed", { lang: "ru" });
    expect(failing.failed).toBe(1);
    expect((await getOrder(ctx, r.order.id))?.status).toBe("awaiting_confirmation");

    // Продавец повторил — выдано.
    const ok = await deliverOrder(ctx, r.order.id, async () => "sent", {
      lang: "ru",
      actor: "admin",
    });
    expect(ok.failed).toBe(0);
    expect((await getOrder(ctx, r.order.id))?.status).toBe("delivered");

    const events = await listOrderEvents(ctx, r.order.id);
    expect(events.map((e) => `${e.kind}:${e.actor}`)).toEqual([
      "placed:bot",
      "proof:bot",
      "delivery_started:bot",
      "item_failed:bot",
      "delivery_failed:bot",
      "delivery_started:admin",
      "item_sent:bot",
      "delivered:bot",
    ]);
    expect(events.find((e) => e.kind === "item_failed")?.payload.name).toBe(PROBE_NAME);
    expect(events.find((e) => e.kind === "placed")?.payload.total).toBe(700);
  });

  it("отклонение продавцом подписано им; чужой заказ в журнал не попадает", async () => {
    expect(await addToCart(ctx, customer, productId)).toBe("ok");
    const r = await placeOrder(ctx, customer, "KZ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    orders.push(r.order.id);
    expect(await rejectOrder(ctx, r.order.id, "admin")).toBe(true);
    const events = await listOrderEvents(ctx, r.order.id);
    expect(events.map((e) => `${e.kind}:${e.actor}`)).toEqual(["placed:bot", "rejected:admin"]);
    expect(await listOrderEvents(ctx, orders[0]!)).toHaveLength(8);
  });
});
