import { Link } from "@tanstack/react-router";
import { imageSrcSet } from "@/core/catalog/image-url";
import { formatMoney } from "@/core/money/money";
import type { ShowcaseSection } from "@/core/storefront/showcase.server";
import { useStorefrontLocale } from "./locale";

/** Блоки главной над каталогом: новинки, хиты, наборы, отзывы (core/storefront/design). */
export function ShowcaseBlocks({ slug, sections }: { slug: string; sections: ShowcaseSection[] }) {
  const { t } = useStorefrontLocale();
  if (sections.length === 0) return null;
  return (
    <div className="mb-8 space-y-8" data-testid="showcase">
      {sections.map((s) => (
        <section key={s.key} data-block={s.key}>
          <h2 className="mb-3 text-lg font-semibold">{t(`showcase.${s.key}`)}</h2>
          {s.key === "reviews" ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {s.reviews.map((r) => (
                <li key={r.id} className="card p-3 text-sm">
                  <div aria-label={`${r.rating}/5`}>{"★".repeat(r.rating)}</div>
                  <p className="mt-1 line-clamp-4 whitespace-pre-line">{r.comment}</p>
                  {r.confirmed && (
                    <p className="mt-1 text-xs text-ok" data-testid="review-confirmed">
                      ✓ {t("review.confirmed")}
                    </p>
                  )}
                  <Link
                    to="/s/$slug/p/$id"
                    params={{ slug, id: r.productId }}
                    className="mt-2 block text-xs text-muted hover:underline"
                  >
                    {r.buyer ? `${r.buyer} · ` : ""}
                    {r.productName}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {s.items.map((p) => (
                <Link
                  key={p.id}
                  to="/s/$slug/p/$id"
                  params={{ slug, id: p.id }}
                  className="card overflow-hidden"
                >
                  {p.images[0] ? (
                    <img
                      src={p.images[0]}
                      srcSet={imageSrcSet(p.images[0])}
                      sizes="(min-width: 640px) 25vw, 50vw"
                      alt={p.name}
                      loading="lazy"
                      decoding="async"
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-square bg-surface-2" />
                  )}
                  <div className="p-2 text-xs">
                    <div className="line-clamp-2">{p.name}</div>
                    <div className="mt-1 font-semibold">{formatMoney(p.price, p.currency)}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
