import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { imagePath } from "@/core/catalog/image-url";
import { eachPage } from "@/core/db/page";
import { isReviewPhotoPath, REVIEW_REPLY_MAX, type ReviewStatus } from "./photos";

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
  /** Публичный ответ продавца на витрине; нет — null. */
  publicReply: string | null;
};

export type ReviewFilter = {
  /** Только эта оценка (1–5). */
  rating?: number;
  /** Только с текстом. */
  withComment?: boolean;
  /** Только те, на которые продавец ещё не отвечал. */
  noReply?: boolean;
  /** Только ждущие решения продавца (в том числе старые, без решения). */
  pending?: boolean;
  /** Только отзывы на этот товар. */
  productId?: string;
  /** Номер страницы, с 1. */
  page?: number;
};

export const ADMIN_REVIEWS_PAGE_SIZE = 20;

/** Читаем таблицу страницами по столько строк; список в админке отдаётся своими страницами. */
const SCAN_PAGE = 200;

type ReviewRow = {
  id: string;
  product_id: string;
  telegram_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewsOverview = {
  items: AdminReview[];
  /** Сколько отзывов подошло под фильтры (до разбивки на страницы). */
  total: number;
  page: number;
  pages: number;
  /** Сводка по ВСЕМ отзывам магазина, фильтры и страница её не меняют. */
  stats: ReturnType<typeof reviewStats> & { pending: number; noReply: number };
  /** Товары, на которые есть отзывы, — для фильтра. */
  products: Array<{ id: string; name: string | null }>;
};

/**
 * Список отзывов для продавца: страница с фильтрами и сводка по всем отзывам.
 * Решение продавца и отметка об ответе лежат в review_meta (app_settings), не
 * в колонках, поэтому таблица читается целиком страницами по 200, а на экран
 * отдаётся одна страница из подошедших. Обход — по неизменному id, «свежие сверху, затем id» — в памяти.
 */
export async function listReviewsForAdmin(
  ctx: TenantContext,
  filter: ReviewFilter = {},
): Promise<ReviewsOverview> {
  type Slim = Pick<ReviewRow, "id" | "product_id" | "rating" | "comment" | "updated_at">;
  const { reviewMetas } = await import("./photos.server");
  const all: Array<Slim & { pending: boolean; replied: boolean }> = [];
  await eachPage<Slim>(
    (a, b) =>
      ctx.db
        .from("product_reviews")
        .select("id, product_id, rating, comment, updated_at")
        // Обход по id: он не меняется. Сортировка по updated_at (его трогает триггер на любую
        // оценку) переносила бы строку между страницами прямо во время чтения.
        .order("id")
        .range(a, b),
    "Отзывы",
    async (rows) => {
      const metas = await reviewMetas(
        ctx,
        rows.map((r) => r.id),
      );
      for (const r of rows) {
        const m = metas.get(r.id);
        all.push({
          ...r,
          pending: (m?.status ?? "pending") === "pending",
          replied: !!m?.repliedAt,
        });
      }
    },
    SCAN_PAGE,
  );
  // «Свежие сверху, затем id» — уже в памяти, после обхода.
  all.sort((x, y) =>
    x.updated_at === y.updated_at ? (x.id < y.id ? -1 : 1) : x.updated_at < y.updated_at ? 1 : -1,
  );
  const stats = {
    ...reviewStats(all),
    pending: all.filter((r) => r.pending).length,
    noReply: all.filter((r) => !r.replied).length,
  };
  const hit = all.filter(
    (r) =>
      (!filter.rating || Number(r.rating) === filter.rating) &&
      (!filter.withComment || !!r.comment?.trim()) &&
      (!filter.noReply || !r.replied) &&
      (!filter.pending || r.pending) &&
      (!filter.productId || r.product_id === filter.productId),
  );
  const pages = Math.max(1, Math.ceil(hit.length / ADMIN_REVIEWS_PAGE_SIZE));
  const page = Math.min(Math.max(1, filter.page ?? 1), pages);
  const ids = hit
    .slice((page - 1) * ADMIN_REVIEWS_PAGE_SIZE, page * ADMIN_REVIEWS_PAGE_SIZE)
    .map((r) => r.id);
  const names = await productNames(ctx, [...new Set(all.map((r) => r.product_id))]);
  const rows = await reviewRowsByIds(ctx, ids);
  return {
    items: await withNames(ctx, rows, names),
    total: hit.length,
    page,
    pages,
    stats,
    products: [...names].map(([id, name]) => ({ id, name })),
  };
}

/** Названия товаров: id → name, кусками по 200; товара нет в базе — null. */
async function productNames(
  ctx: TenantContext,
  productIds: readonly string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>(productIds.map((id) => [id, null]));
  for (let i = 0; i < productIds.length; i += 200) {
    const { data, error } = await ctx.db
      .from("products")
      .select("id, name")
      .in("id", productIds.slice(i, i + 200));
    if (error) throw serverFailure(`Отзывы, товары: ${error.message}`);
    for (const p of (data ?? []) as Array<{ id: string; name: string }>) out.set(p.id, p.name);
  }
  return out;
}

/** Полные строки отзывов по id, в порядке ids. */
async function reviewRowsByIds(ctx: TenantContext, ids: readonly string[]): Promise<ReviewRow[]> {
  const got = new Map<string, ReviewRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await ctx.db
      .from("product_reviews")
      .select("id, product_id, telegram_id, rating, comment, created_at, updated_at")
      .in("id", ids.slice(i, i + 200));
    if (error) throw serverFailure(`Отзывы: ${error.message}`);
    for (const r of (data ?? []) as ReviewRow[]) got.set(r.id, r);
  }
  return ids.flatMap((id) => (got.has(id) ? [got.get(id)!] : []));
}

export async function getReviewForAdmin(
  ctx: TenantContext,
  id: string,
): Promise<AdminReview | null> {
  const { data, error: dataError } = await ctx.db
    .from("product_reviews")
    .select("id, product_id, telegram_id, rating, comment, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (dataError) throw serverFailure(`Отзывы: ${dataError.message}`);
  return data ? ((await withNames(ctx, [data as ReviewRow]))[0] ?? null) : null;
}

async function withNames(
  ctx: TenantContext,
  rows: ReviewRow[],
  known?: Map<string, string | null>,
): Promise<AdminReview[]> {
  if (rows.length === 0) return [];
  const buyerIds = [...new Set(rows.map((r) => Number(r.telegram_id)))];
  // Динамически: модуль читает и страница админки (reviewStats), а
  // серверный код в клиентскую сборку не попадает.
  const { reviewMetas } = await import("./photos.server");
  const [productName, buyers, metas] = await Promise.all([
    known ? Promise.resolve(known) : productNames(ctx, [...new Set(rows.map((r) => r.product_id))]),
    ctx.db
      .from("bot_users")
      .select("telegram_id, first_name, last_name, username, platform")
      .in("telegram_id", buyerIds),
    reviewMetas(
      ctx,
      rows.map((r) => r.id),
    ),
  ]);
  if (buyers.error) throw serverFailure(`Отзывы, покупатели: ${buyers.error.message}`);
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
      publicReply: meta.reply ?? null,
    };
  });
}

/** Сводка для шапки страницы: средняя оценка и сколько каких. */
export function reviewStats(reviews: readonly { rating: number }[]): {
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

export { REVIEW_REPLY_MAX };
