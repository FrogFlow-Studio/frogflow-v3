import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID, dropDemoOrder } from "./live";
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
import { parseReviewMeta, REVIEW_META_PREFIX, reviewMetaKey } from "@/core/reviews/photos";
import {
  referralPercent,
  registerReferral,
  rewardReferrerIfFirstDelivery,
} from "@/core/referrals/referrals";

const REFERRER = TEST_TG_ID + 40;
const REFERRED = TEST_TG_ID + 41;
const PRODUCT_NAME = "v2 probe · товар для отзыва";
let ctx: TenantContext;
let productId = "";
const orderIds: number[] = [];
const seenReviewIds: string[] = [];

/**
 * Строки review_meta, оставшиеся от прежних прогонов (до этой правки тест их
 * не убирал): отзыва уже нет, фото нет. Строки с фото не трогаем — за ними
 * файлы в Storage, их убирает только путь удаления v2.
 */
async function dropOrphanReviewMeta() {
  const db = serviceDb();
  const { data: metas } = await db
    .from("app_settings")
    .select("key, value")
    .eq("bot_id", DEMO_BOT)
    .like("key", `${REVIEW_META_PREFIX}%`)
    .order("key")
    .limit(500);
  const bare = (metas ?? []).filter((m) => parseReviewMeta(m.value).photos.length === 0);
  if (!bare.length) return;
  const ids = bare.map((m) => m.key.slice(REVIEW_META_PREFIX.length));
  const { data: alive } = await db
    .from("product_reviews")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .in("id", ids);
  const keep = new Set((alive ?? []).map((r) => String(r.id)));
  const orphans = ids.filter((id) => !keep.has(id)).map(reviewMetaKey);
  if (orphans.length)
    await db.from("app_settings").delete().eq("bot_id", DEMO_BOT).in("key", orphans);
}

async function cleanup() {
  const db = serviceDb();
  for (const id of orderIds) await dropDemoOrder(id);
  await db.from("referrals").delete().eq("bot_id", DEMO_BOT).eq("referred_telegram_id", REFERRED);
  await db
    .from("promo_codes")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .or("code.like.WELCOME-%,code.like.REF-%");
  // Строка app_settings review_meta:<id> (статус и фото отзыва, #188) — вместе с отзывом.
  const { data: reviews } = await db
    .from("product_reviews")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .in("telegram_id", [REFERRER, REFERRED]);
  const reviewIds = (reviews ?? []).map((r) => String(r.id));
  if (reviewIds.length)
    await db
      .from("app_settings")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .in("key", reviewIds.map(reviewMetaKey));
  await db
    .from("product_reviews")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .in("telegram_id", [REFERRER, REFERRED]);
  await dropOrphanReviewMeta();
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
  afterAll(async () => {
    await cleanup();
    // После теста в «Демо-тестер» не остаётся ни отзыва, ни его строки review_meta.
    const { data: left } = await serviceDb()
      .from("app_settings")
      .select("key")
      .eq("bot_id", DEMO_BOT)
      .in("key", seenReviewIds.map(reviewMetaKey));
    expect(left ?? []).toEqual([]);
  });

  it("переход по ссылке даёт приглашённому промокод один раз; чужой и свой id — нет", async () => {
    expect(await registerReferral(ctx, REFERRED, String(REFERRED))).toBeNull();
    expect(await registerReferral(ctx, REFERRED, "123456789012")).toBeNull();
    const gift = await registerReferral(ctx, REFERRED, String(REFERRER));
    expect(gift?.code.startsWith("WELCOME-")).toBe(true);
    // Процент — настройка клиента (в админке его могли поменять), не константа.
    expect(gift?.percent).toBe(await referralPercent(ctx));
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
    const { data: saved } = await ctx.db
      .from("product_reviews")
      .select("id")
      .eq("product_id", productId);
    seenReviewIds.push(...(saved ?? []).map((r) => String(r.id)));
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
