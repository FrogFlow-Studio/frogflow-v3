import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { markReviewPending } from "./photos.server";

/**
 * Право на отзыв — реально выданная покупка этого товара, а не просто
 * оформленный заказ. rating_avg/rating_count на products пересчитывает
 * триггер MIGRATION-43, здесь их не трогаем.
 */
export async function hasDeliveredPurchase(
  ctx: TenantContext,
  telegramId: number,
  productId: string,
): Promise<boolean> {
  const { data: orders, error: ordersError } = await ctx.db
    .from("orders")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("status", "delivered");
  if (ordersError) throw serverFailure(`Отзывы: ${ordersError.message}`);
  const ids = (orders ?? []).map((o) => o.id);
  if (ids.length === 0) return false;
  const { data: item, error: itemError } = await ctx.db
    .from("order_items")
    .select("id")
    .eq("product_id", productId)
    .in("order_id", ids)
    .limit(1)
    .maybeSingle();
  if (itemError) throw serverFailure(`Отзывы: ${itemError.message}`);
  return Boolean(item);
}

/** Товары выданного заказа, которые можно оценить. */
export async function reviewableProductsForOrder(
  ctx: TenantContext,
  orderId: number,
  telegramId: number,
): Promise<Array<{ productId: string; name: string }>> {
  const { data: order, error: orderError } = await ctx.db
    .from("orders")
    .select("id, order_items(product_id, name_snapshot)")
    .eq("id", orderId)
    .eq("telegram_id", telegramId)
    .eq("status", "delivered")
    .maybeSingle();
  if (orderError) throw serverFailure(`Отзывы: ${orderError.message}`);
  if (!order) return [];
  const seen = new Set<string>();
  const out: Array<{ productId: string; name: string }> = [];
  for (const it of order.order_items ?? []) {
    if (!it.product_id || seen.has(it.product_id)) continue;
    seen.add(it.product_id);
    out.push({ productId: it.product_id, name: it.name_snapshot });
  }
  return out;
}

/** Одна оценка на товар от покупателя: повторная — обновляет. */
export async function saveRating(
  ctx: TenantContext,
  telegramId: number,
  productId: string,
  rating: number,
): Promise<boolean> {
  const { data: existing, error: existingError } = await ctx.db
    .from("product_reviews")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("product_id", productId)
    .maybeSingle();
  if (existingError) throw serverFailure(`Отзывы: ${existingError.message}`);
  const { data: saved, error } = existing
    ? await ctx.db
        .from("product_reviews")
        .update({ rating, comment: null })
        .eq("id", existing.id)
        .select("id")
        .maybeSingle()
    : await ctx.db
        .from("product_reviews")
        .insert({ bot_id: ctx.tenant.id, telegram_id: telegramId, product_id: productId, rating })
        .select("id")
        .maybeSingle();
  // Новая или изменённая оценка — на витрину только после решения продавца.
  if (!error && saved) await markReviewPending(ctx, saved.id);
  return !error;
}

export async function saveComment(
  ctx: TenantContext,
  telegramId: number,
  productId: string,
  comment: string,
): Promise<boolean> {
  // Комментарий дописывается к уже поставленной оценке; нет оценки — false.
  const { data, error } = await ctx.db
    .from("product_reviews")
    .update({ comment: comment.trim().slice(0, 1000) })
    .eq("telegram_id", telegramId)
    .eq("product_id", productId)
    .select("id");
  for (const r of data ?? []) await markReviewPending(ctx, r.id);
  return !error && Boolean(data?.length);
}

export async function listProductReviews(
  ctx: TenantContext,
  productId: string,
  limit = 5,
): Promise<Array<{ rating: number; comment: string | null; created_at: string }>> {
  const { data, error: dataError } = await ctx.db
    .from("product_reviews")
    .select("rating, comment, created_at")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(20, limit)));
  if (dataError) throw serverFailure(`Отзывы: ${dataError.message}`);
  return (data ?? []).map((r) => ({ ...r, rating: Number(r.rating) }));
}
