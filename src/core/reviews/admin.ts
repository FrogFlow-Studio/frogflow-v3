import type { TenantContext } from "@/core/tenant/resolve.server";
import { imagePath } from "@/core/catalog/image-url";
import { isReviewPhotoPath, type ReviewStatus } from "./photos";

/**
 * Отзывы покупателей для продавца: оценка, комментарий, товар и покупатель.
 * Пишутся из бота после выдачи (core/reviews/reviews); здесь только чтение.
 * Ответ на отзыв уходит покупателю сообщением в его канал (app/admin) —
 * отдельной колонки для ответа нет, схема базы не меняется.
 */
export type AdminReview = {
  id: string;
  productId: string;
  productName: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  buyer: {
    telegramId: number;
    name: string | null;
    username: string | null;
    platform: string | null;
  };
  /** Решение продавца для витрины (core/reviews/photos). */
  status: ReviewStatus;
  /** Старый отзыв: оставлен до одобрения продавцом, решения ещё не было. */
  legacy: boolean;
  /** Адреса фото покупателя (/api/img/…). */
  photos: string[];
};

export type ReviewFilter = {
  /** Только эта оценка (1–5). */
  rating?: number;
  /** Только с текстом. */
  withComment?: boolean;
};

export const ADMIN_REVIEWS_LIMIT = 200;

type ReviewRow = {
  id: string;
  product_id: string;
  telegram_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export async function listReviewsForAdmin(
  ctx: TenantContext,
  filter: ReviewFilter = {},
): Promise<AdminReview[]> {
  let q = ctx.db
    .from("product_reviews")
    .select("id, product_id, telegram_id, rating, comment, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(ADMIN_REVIEWS_LIMIT);
  if (filter.rating) q = q.eq("rating", filter.rating);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as ReviewRow[];
  if (filter.withComment) rows = rows.filter((r) => r.comment?.trim());
  return withNames(ctx, rows);
}

export async function getReviewForAdmin(
  ctx: TenantContext,
  id: string,
): Promise<AdminReview | null> {
  const { data } = await ctx.db
    .from("product_reviews")
    .select("id, product_id, telegram_id, rating, comment, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  return data ? ((await withNames(ctx, [data as ReviewRow]))[0] ?? null) : null;
}

async function withNames(ctx: TenantContext, rows: ReviewRow[]): Promise<AdminReview[]> {
  if (rows.length === 0) return [];
  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const buyerIds = [...new Set(rows.map((r) => Number(r.telegram_id)))];
  // Динамически: модуль читает и страница админки (reviewStats), а
  // серверный код в клиентскую сборку не попадает.
  const { reviewMetas } = await import("./photos.server");
  const [products, buyers, metas] = await Promise.all([
    ctx.db.from("products").select("id, name").in("id", productIds),
    ctx.db
      .from("bot_users")
      .select("telegram_id, first_name, last_name, username, platform")
      .in("telegram_id", buyerIds),
    reviewMetas(
      ctx,
      rows.map((r) => r.id),
    ),
  ]);
  const productName = new Map(
    ((products.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  type Buyer = {
    telegram_id: number;
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    platform: string | null;
  };
  const buyer = new Map(((buyers.data ?? []) as Buyer[]).map((b) => [Number(b.telegram_id), b]));
  return rows.map((r) => {
    const b = buyer.get(Number(r.telegram_id));
    const name = [b?.first_name, b?.last_name].filter((s) => s?.trim()).join(" ") || null;
    const meta = metas.get(r.id) ?? { status: "pending" as const, photos: [], stored: false };
    return {
      id: r.id,
      productId: r.product_id,
      productName: productName.get(r.product_id) ?? null,
      rating: Number(r.rating),
      comment: r.comment?.trim() ? r.comment : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      buyer: {
        telegramId: Number(r.telegram_id),
        name,
        username: b?.username ?? null,
        platform: b?.platform ?? null,
      },
      status: meta.status,
      legacy: !meta.stored,
      photos: meta.photos
        .filter((p) => isReviewPhotoPath(r.id, p))
        .map((p) => imagePath(ctx.tenant.id, p)),
    };
  });
}

/** Сводка для шапки страницы: средняя оценка и сколько каких. */
export function reviewStats(reviews: readonly Pick<AdminReview, "rating">[]): {
  count: number;
  avg: number | null;
  byRating: Record<1 | 2 | 3 | 4 | 5, number>;
} {
  const byRating = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  let sum = 0;
  for (const r of reviews) {
    const k = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    byRating[k]++;
    sum += r.rating;
  }
  return {
    count: reviews.length,
    avg: reviews.length ? Math.round((sum / reviews.length) * 10) / 10 : null,
    byRating,
  };
}

export const REVIEW_REPLY_MAX = 1000;
