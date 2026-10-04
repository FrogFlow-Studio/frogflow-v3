import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { REVIEW_PHOTOS_MAX, type ReviewStatus } from "./photos";
import { addReviewPhoto, reviewMeta } from "./photos.server";
import { hasDeliveredPurchase, saveComment, saveRating } from "./reviews";

/**
 * Отзыв с сайта. Оставить его может только вошедший через Telegram покупатель,
 * у которого этот товар в выданном заказе (статус «выдан»: цифровой заказ выдаётся
 * после подтверждённой оплаты, физический — после получения; оплата по возвратам
 * в этом статусе не считается — core/orders/refund). Отзыв, как и из бота,
 * сначала ждёт решения продавца; рейтинг на витрине считают только одобренные.
 */
export const WEB_REVIEW_COMMENT_MAX = 1000;

export type WebReviewState = {
  /** Можно ли оставить отзыв: товар в выданном заказе этого покупателя. */
  canReview: boolean;
  /** Его отзыв на этот товар, если уже есть. */
  mine: { rating: number; comment: string | null; status: ReviewStatus; photos: number } | null;
};

export async function webReviewState(
  ctx: TenantContext,
  telegramId: number,
  productId: string,
): Promise<WebReviewState> {
  const { data, error } = await ctx.db
    .from("product_reviews")
    .select("id, rating, comment")
    .eq("telegram_id", telegramId)
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw serverFailure(`Отзывы: ${error.message}`);
  const canReview = await hasDeliveredPurchase(ctx, telegramId, productId);
  if (!data) return { canReview, mine: null };
  const meta = await reviewMeta(ctx, data.id);
  return {
    canReview,
    mine: {
      rating: Number(data.rating),
      comment: data.comment,
      status: meta.status,
      photos: meta.photos.length,
    },
  };
}

export type WebReviewResult =
  | { ok: true; photosAdded: number; photosRejected: Array<"type" | "size" | "limit" | "failed"> }
  | { ok: false; reason: "no_purchase" | "failed" };

export async function submitWebReview(
  ctx: TenantContext,
  telegramId: number,
  productId: string,
  input: { rating: number; comment: string; photos: readonly Uint8Array[] },
): Promise<WebReviewResult> {
  // Покупку проверяем первой и до любой записи: без выданного заказа не остаётся ни строки, ни файла.
  if (!(await hasDeliveredPurchase(ctx, telegramId, productId)))
    return { ok: false, reason: "no_purchase" };
  if (!(await saveRating(ctx, telegramId, productId, input.rating)))
    return { ok: false, reason: "failed" };
  const comment = input.comment.trim().slice(0, WEB_REVIEW_COMMENT_MAX);
  if (comment && !(await saveComment(ctx, telegramId, productId, comment)))
    return { ok: false, reason: "failed" };
  let photosAdded = 0;
  const photosRejected: Array<"type" | "size" | "limit" | "failed"> = [];
  for (const bytes of input.photos.slice(0, REVIEW_PHOTOS_MAX)) {
    const r = await addReviewPhoto(ctx, telegramId, productId, bytes);
    if (r.ok) photosAdded++;
    else
      photosRejected.push(
        r.reason === "upload_failed" || r.reason === "no_review" ? "failed" : r.reason,
      );
  }
  return { ok: true, photosAdded, photosRejected };
}
