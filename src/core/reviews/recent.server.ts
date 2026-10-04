import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";
import { publicBuyerName } from "./photos";
import { reviewMetas } from "./photos.server";

export type RecentReview = {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  buyer: string | null;
  productId: string;
  productName: string;
};

/**
 * Свежие одобренные продавцом отзывы магазина с текстом — для блока «Отзывы» на
 * главной витрины и страницы «О магазине». Только отзывы товаров, которые сейчас
 * в продаже; неодобренные и без текста не показываем.
 */
export async function recentApprovedReviews(
  ctx: TenantContext,
  limit: number,
): Promise<RecentReview[]> {
  type Row = {
    id: string;
    product_id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    telegram_id: number;
  };
  const picked: Row[] = [];
  await eachPage<Row>(
    (a, b) =>
      ctx.db
        .from("product_reviews")
        .select("id, product_id, rating, comment, created_at, telegram_id")
        .order("created_at", { ascending: false })
        .order("id")
        .range(a, b),
    "product_reviews",
    async (rows) => {
      const metas = await reviewMetas(
        ctx,
        rows.map((r) => r.id),
      );
      for (const r of rows) {
        if (metas.get(r.id)?.status !== "approved" || !r.comment?.trim()) continue;
        picked.push(r);
      }
      // Берём с запасом: часть отзывов отпадёт вместе со снятыми с продажи товарами.
      return picked.length < limit * 3;
    },
    200,
  );
  if (picked.length === 0) return [];
  const productIds = [...new Set(picked.map((r) => r.product_id))];
  const products = await inChunks(
    productIds,
    (chunk) => ctx.db.from("products").select("id, name").in("id", chunk).eq("is_active", true),
    "Отзывы: товары",
  );
  const names = new Map(
    (products as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  const shown = picked.filter((r) => names.has(r.product_id)).slice(0, limit);
  if (shown.length === 0) return [];
  const users = await inChunks(
    [...new Set(shown.map((r) => Number(r.telegram_id)))],
    (chunk) =>
      ctx.db
        .from("bot_users")
        .select("telegram_id, first_name, last_name")
        .in("telegram_id", chunk),
    "Отзывы: покупатели",
  );
  const buyers = new Map(
    (
      users as Array<{ telegram_id: number; first_name: string | null; last_name: string | null }>
    ).map((u) => [Number(u.telegram_id), publicBuyerName(u.first_name, u.last_name)]),
  );
  return shown.map((r) => ({
    id: r.id,
    rating: Number(r.rating),
    comment: r.comment!.trim(),
    createdAt: r.created_at,
    buyer: buyers.get(Number(r.telegram_id)) ?? null,
    productId: r.product_id,
    productName: names.get(r.product_id)!,
  }));
}
