import { useEffect, useState } from "react";
import { storeReviewsFn } from "./reviews.functions";
import { useStorefrontLocale } from "./locale";
import type { PublicReview } from "@/core/reviews/photos";

const stars = (n: number) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));

/** Блок «Отзывы» на странице товара: одобренные продавцом, с фото покупателей. */
export function ProductReviews({ slug, productId }: { slug: string; productId: string }) {
  const { locale, t } = useStorefrontLocale();
  const [rows, setRows] = useState<PublicReview[]>([]);
  useEffect(() => {
    let live = true;
    storeReviewsFn({ data: { slug, id: productId } })
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [slug, productId]);
  if (rows.length === 0) return null;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "kk" ? "kk-KZ" : locale, { dateStyle: "medium" });
  return (
    <section className="mt-10" aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="mb-3 text-sm font-semibold text-muted">
        {t("product.reviewsTitle")}
      </h2>
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
          </li>
        ))}
      </ul>
    </section>
  );
}
