import { useEffect, useState } from "react";
import { storeReviewsFn } from "./reviews.functions";
import { useStorefrontLocale } from "./locale";
import { ReviewForm } from "./review-form";
import type { PublicReview } from "@/core/reviews/photos";

const stars = (n: number) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));

/** Блок «Отзывы» на странице товара: одобренные продавцом, с фото покупателей, фильтры и «Показать ещё». */
export function ProductReviews({ slug, productId }: { slug: string; productId: string }) {
  const { locale, t } = useStorefrontLocale();
  const [rows, setRows] = useState<PublicReview[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [rating, setRating] = useState(0);
  const [withPhoto, setWithPhoto] = useState(false);
  // Были ли у товара отзывы вообще: без них блока нет, с ними он остаётся и при пустом фильтре.
  const [any, setAny] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = (offset: number) =>
    storeReviewsFn({
      data: {
        slug,
        id: productId,
        rating: rating || undefined,
        withPhoto: withPhoto || undefined,
        offset: offset || undefined,
      },
    });
  useEffect(() => {
    let live = true;
    query(0)
      .then((r) => {
        if (!live) return;
        setRows(r.items);
        setHasMore(r.hasMore);
        if (r.items.length > 0) setAny(true);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, productId, rating, withPhoto]);
  const more = async () => {
    setBusy(true);
    try {
      const r = await query(rows.length);
      setRows((p) => {
        const seen = new Set(p.map((x) => x.id));
        return [...p, ...r.items.filter((x) => !seen.has(x.id))];
      });
      setHasMore(r.hasMore);
    } catch {
      /* кнопка остаётся: можно нажать снова */
    } finally {
      setBusy(false);
    }
  };
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "kk" ? "kk-KZ" : locale, { dateStyle: "medium" });
  const hasReviews = any || rows.length > 0;
  // Без отзывов блока нет; форма «Оставить отзыв» есть у того, кто может его написать.
  if (!hasReviews) return <ReviewForm slug={slug} productId={productId} hasReviews={false} />;
  return (
    <section className="mt-10" aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="mb-3 text-sm font-semibold text-muted">
        {t("product.reviewsTitle")}
      </h2>
      <ReviewForm slug={slug} productId={productId} hasReviews />
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <select
          className="input w-auto"
          aria-label={t("product.reviewsRating")}
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
        >
          <option value={0}>{t("product.reviewsAllRatings")}</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {"★".repeat(n)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={withPhoto}
            onChange={(e) => setWithPhoto(e.target.checked)}
          />
          {t("product.reviewsWithPhoto")}
        </label>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted">{t("product.reviewsNone")}</p>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-accent" aria-label={`${r.rating}/5`}>
                {stars(r.rating)}
              </span>
              <span className="text-xs text-muted">
                {r.buyer ?? t("product.reviewBuyer")} · {date(r.createdAt)}
              </span>
            </div>
            {r.comment && (
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{r.comment}</p>
            )}
            {r.photos.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {r.photos.map((src) => (
                  <a key={src} href={src} target="_blank" rel="noreferrer">
                    <img
                      src={src}
                      alt={t("product.reviewPhoto")}
                      loading="lazy"
                      className="h-20 w-20 rounded-md border border-line object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
            {r.reply && (
              <div className="mt-3 rounded-md border-l-2 border-accent bg-surface/60 py-1 pl-3">
                <p className="text-xs font-semibold text-muted">{t("product.reviewReply")}</p>
                <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{r.reply}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          className="btn-secondary mt-3"
          disabled={busy}
          onClick={() => void more()}
        >
          {t("product.reviewsMore")}
        </button>
      )}
    </section>
  );
}
