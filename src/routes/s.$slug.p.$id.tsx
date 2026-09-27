import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { storeProductFn } from "@/app/storefront/storefront.functions";
import { useCart } from "@/app/storefront/cart";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { reviewsWord } from "@/app/i18n/storefront";
import { formatMoney } from "@/core/money/money";
import { pageBadge } from "@/core/catalog/lead-time";
import { ProductReviews } from "@/app/storefront/reviews";
import { productMeta } from "@/core/storefront/share";
import { storeProductSeoFn } from "@/app/storefront/share.functions";
import {
  canonicalLink,
  jsonLdScript,
  productCanonical,
  productJsonLd,
} from "@/core/storefront/seo";

export const Route = createFileRoute("/s/$slug/p/$id")({
  loader: async ({ params }) => {
    const [page, seo] = await Promise.all([
      storeProductFn({ data: { slug: params.slug, id: params.id } }),
      // Разметка для поиска не должна ронять страницу товара.
      storeProductSeoFn({ data: { slug: params.slug, id: params.id } }).catch(() => null),
    ]);
    return { ...page, seo };
  },
  head: ({ loaderData, matches }) => {
    const shop = matches.find((m) => (m.routeId as string) === "/s/$slug")?.loaderData as
      | {
          slug: string;
          name: string;
          tagline: string | null;
          accent: string | null;
          share: { origin: string; canonical: string; cover: string | null };
        }
      | undefined;
    const seoShop = shop && { name: shop.name, slug: shop.slug, origin: shop.share.canonical };
    if (!loaderData) return { meta: [] };
    const share = productMeta(
      loaderData.product,
      shop
        ? {
            slug: shop.slug,
            name: shop.name,
            tagline: shop.tagline,
            accent: shop.accent,
            origin: shop.share.origin,
            cover: shop.share.cover,
          }
        : null,
    );
    // Разметка товара — только если он виден в каталоге витрины (как в карте сайта).
    const ld =
      seoShop && loaderData.seo?.listed
        ? [jsonLdScript(productJsonLd(loaderData.product, seoShop, loaderData.seo.rating))]
        : [];
    return {
      meta: share,
      scripts: ld,
      links: seoShop
        ? [canonicalLink(productCanonical(seoShop.origin, seoShop.slug, loaderData.product.id))]
        : [],
    };
  },
  component: ProductPage,
});

function ProductPage() {
  const { product: p, related } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { locale, t } = useStorefrontLocale();
  const cart = useCart();
  const [img, setImg] = useState(0);
  const [variant, setVariant] = useState<string | null>(p.variants[0]?.id ?? null);
  const [msg, setMsg] = useState<string | null>(null);
  const chosen = p.variants.find((v) => v.id === variant) ?? null;
  const price = chosen ? chosen.price : p.price;
  const currency = chosen ? chosen.currency : p.currency;
  const add = () => {
    const r = cart.add({
      productId: p.id,
      variantId: chosen?.id ?? null,
      name: chosen ? `${p.name} (${chosen.name})` : p.name,
      price,
      currency,
      image: p.images[0] ?? null,
      kind: p.kind,
    });
    setMsg(r === "ok" ? t("product.addedToCart") : t("catalog.mixed"));
    setTimeout(() => setMsg(null), 2000);
  };
  return (
    <>
      <nav className="text-sm text-muted">
        <Link to="/s/$slug" params={{ slug }} className="hover:underline">
          {t("catalog.title")}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-fg">{p.name}</span>
      </nav>
      <div className="mt-3 grid gap-6 md:grid-cols-2">
        <div>
          {p.images[img] ? (
            <img
              src={p.images[img]}
              alt={p.name}
              className="aspect-square w-full rounded-lg object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-lg bg-surface-2 text-5xl">
              📦
            </div>
          )}
          {p.images.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {p.images.map((src, i) => (
                <button
                  key={src}
                  onClick={() => setImg(i)}
                  className={`shrink-0 rounded border-2 ${i === img ? "border-accent" : "border-transparent"}`}
                >
                  <img src={src} alt="" className="h-16 w-16 rounded object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="badge">{t(pageBadge(p))}</span>
            {p.rating && (
              <span>
                ★ {p.rating.avg.toFixed(1)} · {p.rating.count} {reviewsWord(locale, p.rating.count)}
              </span>
            )}
          </div>
          <div className="mt-3 text-2xl font-semibold tabular-nums">
            {formatMoney(price, currency)}
          </div>
          {p.leadTimeDays ? (
            <div className="mt-1 text-sm text-muted">
              {t("product.leadTime", { n: p.leadTimeDays })}
            </div>
          ) : null}
          {p.kind === "digital" && (p.files?.length ?? 0) > 0 ? (
            <div className="mt-3">
              <div className="label">{t("product.filesTitle")}</div>
              <ul className="space-y-1 text-sm">
                {p.files!.map((f, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span aria-hidden>📄</span>
                    <span className="min-w-0 flex-1 break-words">
                      {f.name || t("product.fileUnnamed")}
                    </span>
                    {p.languages.length > 1 && (
                      <span className="shrink-0 text-xs text-muted">
                        {f.lang === "kk" ? "KZ" : f.lang.toUpperCase()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            p.kind === "digital" &&
            p.languages.length > 0 && (
              <div className="mt-1 text-sm text-muted">
                {t("product.files", { langs: p.languages.map((l) => l.toUpperCase()).join(", ") })}
              </div>
            )
          )}
          {p.variants.length > 0 && (
            <div className="mt-4">
              <div className="label">{t("product.variant")}</div>
              <div className="flex flex-wrap gap-2">
                {p.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVariant(v.id)}
                    className={`badge cursor-pointer px-3 py-1.5 text-sm ${variant === v.id ? "border-accent bg-accent/10 text-accent" : ""}`}
                  >
                    {v.name} · {formatMoney(v.price, v.currency)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-5 flex items-center gap-3">
            {p.inStock ? (
              <button className="btn-primary px-5 py-2.5 text-base" onClick={add}>
                {t("product.addToCart")}
              </button>
            ) : (
              <span className="badge">{t("product.outOfStock")}</span>
            )}
            {msg && <span className="text-sm text-muted">{msg}</span>}
          </div>
          <ul className="mt-5 space-y-1.5 text-sm text-muted">
            {p.kind === "digital" ? (
              <>
                <li>{t("product.digitalInstant")}</li>
                <li>{t("product.digitalResend")}</li>
              </>
            ) : (
              <>
                <li>{t("product.physicalDate")}</li>
                <li>{t("product.physicalDelivery")}</li>
              </>
            )}
            <li>{t("product.payment")}</li>
          </ul>
          {p.description && (
            <div className="mt-6 border-t border-line pt-5">
              <h2 className="mb-2 text-sm font-semibold">{t("product.description")}</h2>
              <p className="text-sm leading-relaxed whitespace-pre-line">{p.description}</p>
            </div>
          )}
        </div>
      </div>
      <ProductReviews slug={slug} productId={p.id} />
      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-muted">{t("product.related")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map((r) => (
              <Link
                key={r.id}
                to="/s/$slug/p/$id"
                params={{ slug, id: r.id }}
                className="card overflow-hidden"
              >
                {r.images[0] ? (
                  <img
                    src={r.images[0]}
                    alt=""
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="aspect-square bg-surface-2" />
                )}
                <div className="p-2 text-xs">
                  <div className="line-clamp-2">{r.name}</div>
                  <div className="mt-1 font-semibold">{formatMoney(r.price, r.currency)}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
