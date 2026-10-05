import { confirmedPurchases } from "./recent.server";
import { serverFailure } from "@/lib/server-failure";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serviceDb } from "@/core/db/client.server";
import { eachPage } from "@/core/db/page";
import { imagePath } from "@/core/catalog/image-url";
import { getSetting, getSettingsStrict, updateSettingStamped } from "@/core/settings/settings";
export type { PublicReview } from "./photos";
import {
  checkReviewPhoto,
  isReviewPhotoPath,
  parseReviewMeta,
  publicBuyerName,
  REVIEW_PHOTOS_MAX,
  REVIEW_REPLY_MAX,
  reviewMetaKey,
  reviewPhotoPath,
  type PublicReview,
  type ReviewMeta,
  type ReviewStatus,
} from "./photos";

/** Отзывы с фото и одобрением продавца (core/reviews/photos). */

const BUCKET = "product-images";

export async function reviewMeta(ctx: TenantContext, reviewId: string): Promise<ReviewMeta> {
  return parseReviewMeta(await getSetting(ctx, reviewMetaKey(reviewId)));
}

/** stored: false — строки review_meta нет, отзыв оставлен до #188 (или ботом v1). */
export async function reviewMetas(
  ctx: TenantContext,
  reviewIds: readonly string[],
): Promise<Map<string, ReviewMeta & { stored: boolean }>> {
  const out = new Map<string, ReviewMeta & { stored: boolean }>();
  for (let i = 0; i < reviewIds.length; i += 200) {
    const part = reviewIds.slice(i, i + 200);
    const raw = await getSettingsStrict(ctx, part.map(reviewMetaKey));
    for (const id of part) {
      const v = raw[reviewMetaKey(id)];
      out.set(id, { ...parseReviewMeta(v), stored: v != null });
    }
  }
  return out;
}

/** Отзыв покупателя на товар (один на пару покупатель + товар). */
async function buyerReviewId(
  ctx: TenantContext,
  telegramId: number,
  productId: string,
): Promise<string | null> {
  const { data, error: dataError } = await ctx.db
    .from("product_reviews")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("product_id", productId)
    .maybeSingle();
  if (dataError) throw serverFailure(`Фото отзывов: ${dataError.message}`);
  return data?.id ?? null;
}

export type AddPhotoResult =
  | { ok: true; count: number }
  | { ok: false; reason: "no_review" | "type" | "size" | "limit" | "upload_failed" };

/**
 * Фото к отзыву. Файл сначала ложится в хранилище под новым именем, потом
 * путь атомарно (CAS) дописывается в review_meta, только пока фото меньше
 * лимита. Альбом Telegram приходит пачкой почти одновременных обновлений:
 * проигравшие гонку за последнее место удаляют свой файл. Новое фото
 * возвращает отзыв на решение продавца.
 */
export async function addReviewPhoto(
  ctx: TenantContext,
  telegramId: number,
  productId: string,
  bytes: Uint8Array,
): Promise<AddPhotoResult> {
  const reviewId = await buyerReviewId(ctx, telegramId, productId);
  if (!reviewId) return { ok: false, reason: "no_review" };
  const check = checkReviewPhoto(bytes);
  if (!check.ok) return { ok: false, reason: check.reason };
  if ((await reviewMeta(ctx, reviewId)).photos.length >= REVIEW_PHOTOS_MAX)
    return { ok: false, reason: "limit" };
  const rel = reviewPhotoPath(reviewId, `${randomUUID()}.${check.kind.ext}`);
  const key = `${ctx.tenant.id}/${rel}`;
  const bucket = serviceDb().storage.from(BUCKET);
  const up = await bucket.upload(key, new Blob([bytes as BlobPart], { type: check.kind.mime }), {
    contentType: check.kind.mime,
    upsert: false,
  });
  if (up.error) return { ok: false, reason: "upload_failed" };
  let count = 0;
  const r = await updateSettingStamped(ctx, reviewMetaKey(reviewId), (raw) => {
    const m = parseReviewMeta(raw);
    if (m.photos.length >= REVIEW_PHOTOS_MAX) return null;
    count = m.photos.length + 1;
    return JSON.stringify({
      ...m,
      status: "pending",
      photos: [...m.photos, rel],
    } satisfies ReviewMeta);
  });
  if (r !== "written") {
    await bucket.remove([key]);
    return { ok: false, reason: r === "skipped" ? "limit" : "upload_failed" };
  }
  return { ok: true, count };
}

/**
 * Новый отзыв или изменённые текст и оценка — отзыв ждёт решения продавца.
 * Строка review_meta заводится сразу, поэтому отзыв без неё — старый
 * (оставлен до появления одобрения), см. approveLegacyReviews.
 */
export async function markReviewPending(ctx: TenantContext, reviewId: string): Promise<void> {
  await updateSettingStamped(ctx, reviewMetaKey(reviewId), (raw) => {
    const m = parseReviewMeta(raw);
    return raw != null && m.status === "pending"
      ? null
      : JSON.stringify({ ...m, status: "pending" } satisfies ReviewMeta);
  });
}

/** Бюджет одного нажатия «Одобрить все старые»: функция живёт меньше 120 с. */
export const APPROVE_LEGACY_BUDGET_MS = 90_000;

/**
 * «Одобрить все старые»: отзывы без строки review_meta (оставленные до
 * одобрения продавцом) получают «показан на витрине». Отзыв, у которого
 * строка уже есть (новый, изменённый, скрытый продавцом), не трогаем:
 * запись только если строки всё ещё нет. Время ограничено: когда бюджет вышел,
 * новые записи не начинаем, а остаток только считаем (чтение дешёвое), и
 * продавец видит честный итог «одобрено N, осталось M» и жмёт ещё раз.
 */
export async function approveLegacyReviews(
  ctx: TenantContext,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<{ approved: number; remaining: number }> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? APPROVE_LEGACY_BUDGET_MS);
  const approved = JSON.stringify({ status: "approved", photos: [] } satisfies ReviewMeta);
  let count = 0;
  let remaining = 0;
  await eachPage(
    (a, b) => ctx.db.from("product_reviews").select("id").order("id").range(a, b),
    "product_reviews",
    async (rows) => {
      const metas = await reviewMetas(
        ctx,
        rows.map((r) => r.id),
      );
      for (const r of rows) {
        if (metas.get(r.id)!.stored) continue;
        if (now() >= deadline) {
          remaining++;
          continue;
        }
        const w = await updateSettingStamped(ctx, reviewMetaKey(r.id), (raw) =>
          raw == null ? approved : null,
        );
        if (w === "failed") throw serverFailure("review_meta: запись не удалась");
        if (w === "written") count++;
      }
    },
    200,
  );
  return { approved: count, remaining };
}

/** Решение продавца: показать на витрине или скрыть. */
export async function setReviewStatus(
  ctx: TenantContext,
  reviewId: string,
  status: Exclude<ReviewStatus, "pending">,
): Promise<boolean> {
  const r = await updateSettingStamped(ctx, reviewMetaKey(reviewId), (raw) => {
    const m = parseReviewMeta(raw);
    return m.status === status && raw != null ? null : JSON.stringify({ ...m, status });
  });
  return r !== "failed";
}

/**
 * Продавец ответил покупателю: отметка нужна фильтру «без ответа». Вызывается
 * после отправки; сорвавшаяся запись ответ не отменяет (повторять отправку нельзя).
 */
export async function markReviewReplied(
  ctx: TenantContext,
  reviewId: string,
  /** Публичный ответ для витрины; null — только отметка (ответ ушёл личным сообщением). */
  publicReply: string | null = null,
): Promise<boolean> {
  const text = publicReply?.trim().slice(0, REVIEW_REPLY_MAX) || null;
  const r = await updateSettingStamped(ctx, reviewMetaKey(reviewId), (raw) => {
    const m = parseReviewMeta(raw);
    return JSON.stringify({
      ...m,
      repliedAt: new Date().toISOString(),
      ...(text ? { reply: text } : {}),
    } satisfies ReviewMeta);
  });
  return r !== "failed";
}

/** «Убрать ответ с витрины»: публичный ответ уходит, отметка «отвечено» остаётся. */
export async function clearPublicReply(ctx: TenantContext, reviewId: string): Promise<boolean> {
  const r = await updateSettingStamped(ctx, reviewMetaKey(reviewId), (raw) => {
    const m = parseReviewMeta(raw);
    if (!m.reply) return null;
    const { reply: _gone, ...rest } = m;
    return JSON.stringify(rest satisfies ReviewMeta);
  });
  return r !== "failed";
}

/**
 * Отзывы удалены (вместе с товаром): их фото и строки review_meta — следом,
 * чтобы не оставались сиротами. Только свои пути, только v2-путь удаления.
 */
export async function dropReviewExtras(
  ctx: TenantContext,
  reviewIds: readonly string[],
): Promise<void> {
  if (reviewIds.length === 0) return;
  const metas = await reviewMetas(ctx, reviewIds);
  const keys = reviewIds.flatMap((id) =>
    (metas.get(id)?.photos ?? [])
      .filter((p) => isReviewPhotoPath(id, p))
      .map((p) => `${ctx.tenant.id}/${p}`),
  );
  if (keys.length) await serviceDb().storage.from(BUCKET).remove(keys);
  for (let i = 0; i < reviewIds.length; i += 200) {
    const { error } = await ctx.db
      .from("app_settings")
      .delete()
      .in("key", reviewIds.slice(i, i + 200).map(reviewMetaKey));
    if (error) throw serverFailure(`review_meta: ${error.message}`);
  }
}

/** id отзывов товара — постранично, по порядку. */
export async function productReviewIds(ctx: TenantContext, productId: string): Promise<string[]> {
  const ids: string[] = [];
  await eachPage(
    (a, b) =>
      ctx.db
        .from("product_reviews")
        .select("id")
        .eq("product_id", productId)
        .order("id")
        .range(a, b),
    "product_reviews",
    (rows) => void ids.push(...rows.map((r) => r.id)),
  );
  return ids;
}

/** Сколько отзывов витрина показывает за раз («Показать ещё» — следующие). */
export const STORE_REVIEWS_PAGE = 10;

export type StoreReviewFilter = {
  /** Только эта оценка (1–5). */
  rating?: number;
  /** Только с фото покупателя. */
  withPhoto?: boolean;
  offset?: number;
  limit?: number;
};

/**
 * Одобренные продавцом отзывы товара для витрины, свежие сверху (затем id),
 * постранично и с фильтрами «с фото» и «по оценке». Читаем страницами по порядку,
 * пока не наберём `offset + limit + 1` подходящих: лишний показывает, есть ли ещё.
 */
export async function approvedReviewsPage(
  ctx: TenantContext,
  productId: string,
  filter: StoreReviewFilter = {},
): Promise<{ items: PublicReview[]; hasMore: boolean }> {
  type Row = {
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    telegram_id: number;
  };
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.min(Math.max(1, filter.limit ?? STORE_REVIEWS_PAGE), 50);
  const want = offset + limit + 1;
  const picked: Array<Row & { meta: ReviewMeta }> = [];
  await eachPage<Row>(
    (a, b) =>
      ctx.db
        .from("product_reviews")
        .select("id, rating, comment, created_at, telegram_id")
        .eq("product_id", productId)
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
        const meta = metas.get(r.id)!;
        if (meta.status !== "approved") continue;
        if (filter.rating && Number(r.rating) !== filter.rating) continue;
        if (filter.withPhoto && !meta.photos.some((p) => isReviewPhotoPath(r.id, p))) continue;
        picked.push({ ...r, meta });
        if (picked.length >= want) return false;
      }
      return true;
    },
    200,
  );
  const hasMore = picked.length > offset + limit;
  const shown = picked.slice(offset, offset + limit);
  if (shown.length === 0) return { items: [], hasMore: false };
  const { data: users, error: usersError } = await ctx.db
    .from("bot_users")
    .select("telegram_id, first_name, last_name")
    .in("telegram_id", [...new Set(shown.map((r) => Number(r.telegram_id)))]);
  if (usersError) throw serverFailure(`Фото отзывов: ${usersError.message}`);
  const names = new Map(
    (users ?? []).map((u) => [Number(u.telegram_id), publicBuyerName(u.first_name, u.last_name)]),
  );
  const confirmed = await confirmedPurchases(
    ctx,
    shown.map((r) => ({ telegramId: Number(r.telegram_id), productId })),
  );
  const items = shown.map((r) => ({
    id: r.id,
    rating: Number(r.rating),
    comment: r.comment?.trim() ? r.comment.trim() : null,
    createdAt: r.created_at,
    buyer: names.get(Number(r.telegram_id)) ?? null,
    photos: r.meta.photos
      .filter((p) => isReviewPhotoPath(r.id, p))
      .map((p) => imagePath(ctx.tenant.id, p)),
    reply: r.meta.reply ?? null,
    confirmed: confirmed.has(`${Number(r.telegram_id)}:${productId}`),
  }));
  return { items, hasMore };
}

/** Первые `limit` одобренных отзывов товара (без фильтров). */
export async function approvedReviews(
  ctx: TenantContext,
  productId: string,
  limit = 20,
): Promise<PublicReview[]> {
  return (await approvedReviewsPage(ctx, productId, { limit })).items;
}

/**
 * Средняя оценка и число отзывов товаров — только одобренные продавцом, как их
 * видит покупатель на витрине. Одно число на карточке каталога, избранном,
 * странице товара и в разметке для поиска: все берут его отсюда. Товар без
 * одобренных отзывов в ответе отсутствует.
 */
export async function approvedRatings(
  ctx: TenantContext,
  productIds: readonly string[],
): Promise<Map<string, { avg: number; count: number }>> {
  const sums = new Map<string, { sum: number; count: number }>();
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += 200) {
    await eachPage<{ id: string; product_id: string; rating: number }>(
      (a, b) =>
        ctx.db
          .from("product_reviews")
          .select("id, product_id, rating")
          .in("product_id", ids.slice(i, i + 200))
          .order("id")
          .range(a, b),
      "product_reviews",
      async (rows) => {
        const metas = await reviewMetas(
          ctx,
          rows.map((r) => r.id),
        );
        for (const r of rows) {
          const rating = Number(r.rating);
          if (metas.get(r.id)?.status !== "approved" || !(rating >= 1 && rating <= 5)) continue;
          const t = sums.get(r.product_id) ?? { sum: 0, count: 0 };
          t.sum += rating;
          t.count++;
          sums.set(r.product_id, t);
        }
      },
      200,
    );
  }
  return new Map(
    [...sums].map(([id, t]) => [
      id,
      { avg: Math.round((t.sum / t.count) * 10) / 10, count: t.count },
    ]),
  );
}

export async function approvedRating(
  ctx: TenantContext,
  productId: string,
): Promise<{ avg: number; count: number } | null> {
  return (await approvedRatings(ctx, [productId])).get(productId) ?? null;
}
