import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer, userKey } from "@/core/customers/customers";
import {
  hasDeliveredPurchase,
  listProductReviews,
  reviewableProductsForOrder,
  saveComment,
  saveRating,
} from "@/core/reviews/reviews";
import { registerReferral, rewardReferrerIfFirstDelivery } from "@/core/referrals/referrals";

const REFERRER = TEST_TG_ID + 40;
const REFERRED = TEST_TG_ID + 41;
const PRODUCT_NAME = "v2 probe · товар для отзыва";
let ctx: TenantContext;
let productId = "";
const orderIds: number[] = [];

async function cleanup() {
  const db = serviceDb();
  for (const id of orderIds) await db.from("orders").delete().eq("id", id);
  await db.from("referrals").delete().eq("bot_id", DEMO_BOT).eq("referred_telegram_id", REFERRED);
  await db
    .from("promo_codes")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .or("code.like.WELCOME-%,code.like.REF-%");
  await db
    .from("product_reviews")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .in("telegram_id", [REFERRER, REFERRED]);
  await db.from("products").delete().eq("bot_id", DEMO_BOT).eq("name", PRODUCT_NAME);
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .in("user_key", [userKey("telegram", REFERRER), userKey("telegram", REFERRED)]);
}

describe.skipIf(!liveReady)("отзывы и рефералы на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: { ...tenant.modules, referral: true, review_request: true },
    });
    await cleanup();
    await upsertCustomer(ctx, "telegram", REFERRER, { firstName: "Пригласивший" });
    await upsertCustomer(ctx, "telegram", REFERRED, { firstName: "Приглашённый" });
    const { data: p } = await ctx.db
      .from("products")
      .insert({
        bot_id: DEMO_BOT,
        name: PRODUCT_NAME,
        price: 500,
        currency: "KZT",
        is_active: true,
        fulfillment_kind: "digital",
        category_ids: [],
        country_prices: {},
      })
      .select("id")
      .single();
    productId = p!.id;
  });
  afterAll(cleanup);

  it("переход по ссылке даёт приглашённому промокод один раз; чужой и свой id — нет", async () => {
    expect(await registerReferral(ctx, REFERRED, String(REFERRED))).toBeNull();
    expect(await registerReferral(ctx, REFERRED, "123456789012")).toBeNull();
    const gift = await registerReferral(ctx, REFERRED, String(REFERRER));
    expect(gift?.code.startsWith("WELCOME-")).toBe(true);
    expect(gift?.percent).toBe(10);
    expect(await registerReferral(ctx, REFERRED, String(REFERRER))).toBeNull();
    const { data: promo } = await ctx.db
      .from("promo_codes")
      .select("max_uses, discount_value")
      .eq("code", gift!.code)
      .single();
    expect(promo?.max_uses).toBe(1);
  });

  it("без выданной покупки оценивать нельзя и награды нет", async () => {
    expect(await hasDeliveredPurchase(ctx, REFERRED, productId)).toBe(false);
    expect(await rewardReferrerIfFirstDelivery(ctx, REFERRED)).toBeNull();
  });

  it("после выдачи: оценка с комментарием, рейтинг на товаре, награда пригласившему один раз", async () => {
    const { data: order } = await ctx.db
      .from("orders")
      .insert({
        bot_id: DEMO_BOT,
        telegram_id: REFERRED,
        user_key: userKey("telegram", REFERRED),
        platform: "telegram",
        display_name: "Приглашённый",
        total: 500,
        currency: "KZT",
        status: "delivered",
        fulfillment_kind: "digital",
      })
      .select("id")
      .single();
    orderIds.push(order!.id);
    await ctx.db.from("order_items").insert({
      bot_id: DEMO_BOT,
      order_id: order!.id,
      product_id: productId,
      name_snapshot: PRODUCT_NAME,
      price_snapshot: 500,
      quantity: 1,
    });

    const reviewable = await reviewableProductsForOrder(ctx, order!.id, REFERRED);
    expect(reviewable.map((r) => r.productId)).toEqual([productId]);
    expect(await hasDeliveredPurchase(ctx, REFERRED, productId)).toBe(true);
    expect(await saveRating(ctx, REFERRED, productId, 5)).toBe(true);
    expect(await saveRating(ctx, REFERRED, productId, 4)).toBe(true); // повтор — обновление
    expect(await saveComment(ctx, REFERRED, productId, "Отличный материал")).toBe(true);
    const reviews = await listProductReviews(ctx, productId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ rating: 4, comment: "Отличный материал" });
    const { data: p } = await ctx.db
      .from("products")
      .select("rating_avg, rating_count")
      .eq("id", productId)
      .single();
    expect(p?.rating_count).toBe(1);
    expect(Number(p?.rating_avg)).toBe(4);

    const reward = await rewardReferrerIfFirstDelivery(ctx, REFERRED);
    expect(reward?.telegramId).toBe(REFERRER);
    expect(reward?.code.startsWith("REF-")).toBe(true);
    expect(await rewardReferrerIfFirstDelivery(ctx, REFERRED)).toBeNull();
    const { data: ref } = await ctx.db
      .from("referrals")
      .select("status, reward_promo_code")
      .eq("referred_telegram_id", REFERRED)
      .single();
    expect(ref?.status).toBe("rewarded");
    expect(ref?.reward_promo_code).toBe(reward?.code);
  });
});
