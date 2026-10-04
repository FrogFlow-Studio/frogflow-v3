/**
 * Отзывы на витрине: решение продавца и фото покупателя. В product_reviews
 * таких колонок нет, схема базы не меняется, поэтому у каждого отзыва своя
 * строка app_settings `review_meta:<id отзыва>` с JSON {status, photos}.
 * Фото — в бакете product-images под префиксом магазина
 * (`<bot>/reviews/<id отзыва>/<uuid>.<ext>`), их отдаёт /api/img.
 *
 * Модуль без базы: его читают сервер, админка и тесты.
 */

export const REVIEW_META_PREFIX = "review_meta:";
export const REVIEW_PHOTOS_MAX = 3;
export const REVIEW_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type ReviewStatus = "pending" | "approved" | "hidden";
/** repliedAt — когда продавец ответил покупателю (ISO); нет — ответа не было. */
export type ReviewMeta = { status: ReviewStatus; photos: string[]; repliedAt?: string };

export const reviewMetaKey = (reviewId: string) => `${REVIEW_META_PREFIX}${reviewId}`;

const EMPTY: ReviewMeta = { status: "pending", photos: [] };

/** Разбор строки настроек; битая или чужая — «ждёт решения», без фото. */
export function parseReviewMeta(raw: string | null | undefined): ReviewMeta {
  if (!raw) return { ...EMPTY, photos: [] };
  try {
    const v = JSON.parse(raw) as Partial<ReviewMeta>;
    const status: ReviewStatus =
      v.status === "approved" || v.status === "hidden" ? v.status : "pending";
    const photos = Array.isArray(v.photos)
      ? v.photos.filter((p): p is string => typeof p === "string").slice(0, REVIEW_PHOTOS_MAX)
      : [];
    return typeof v.repliedAt === "string"
      ? { status, photos, repliedAt: v.repliedAt }
      : { status, photos };
  } catch {
    return { ...EMPTY, photos: [] };
  }
}

/** Путь фото внутри магазина (без префикса bot_id) — только в папке своего отзыва. */
export function reviewPhotoPath(reviewId: string, name: string): string {
  return `reviews/${reviewId}/${name}`;
}

export function isReviewPhotoPath(reviewId: string, path: string): boolean {
  return new RegExp(`^reviews/${reviewId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(path);
}

export type ImageKind = {
  mime: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
};

/** Тип картинки по первым байтам (имя и заявленный тип не в счёт); не картинка — null. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x))
    return { mime: "image/png", ext: "png" };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  return null;
}

export type PhotoCheck = { ok: true; kind: ImageKind } | { ok: false; reason: "type" | "size" };

export function checkReviewPhoto(bytes: Uint8Array): PhotoCheck {
  if (bytes.length === 0 || bytes.length > REVIEW_PHOTO_MAX_BYTES)
    return { ok: false, reason: "size" };
  const kind = sniffImage(bytes);
  return kind ? { ok: true, kind } : { ok: false, reason: "type" };
}

/** Имя покупателя на витрине: «Анна К.»; нет имени — null (витрина пишет «Покупатель»). */
export function publicBuyerName(first: string | null | undefined, last: string | null | undefined) {
  const f = (first ?? "").trim().split(/\s+/)[0] ?? "";
  const l = (last ?? "").trim();
  if (!f) return null;
  return l ? `${f.slice(0, 40)} ${[...l][0]!.toUpperCase()}.` : f.slice(0, 40);
}

/** Отзыв на витрине: только то, что можно показать покупателям. */
export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  buyer: string | null;
  photos: string[];
};
