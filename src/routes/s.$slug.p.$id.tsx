import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { useState } from "react";
import { storeProductFn } from "@/app/storefront/storefront.functions";
import { useCart } from "@/app/storefront/cart";
import { FavoriteButton } from "@/app/storefront/favorites";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { reviewsWord } from "@/app/i18n/storefront";
import { formatMoney } from "@/core/money/money";
import { intlLocale } from "@/app/i18n/admin";
import { Breadcrumbs } from "@/app/storefront/breadcrumbs";
import { OfferNote, OfferPrice } from "@/app/storefront/offer";
import { pageBadge } from "@/core/catalog/lead-time";
import { ProductReviews } from "@/app/storefront/reviews";
import { productMeta } from "@/core/storefront/share";
import { storeProductSeoFn } from "@/app/storefront/share.functions";
import {
  canonicalLink,
  jsonLdScript,
  productCanonical,
  productJsonLd,
  breadcrumbJsonLd,
  storefrontCrumbs,
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
          categories: Array<{ id: string; name: string; parent_id: string | null }>;
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
        ? [
            jsonLdScript(productJsonLd(loaderData.product, seoShop, loaderData.seo.rating)),
            jsonLdScript(
              breadcrumbJsonLd(
                storefrontCrumbs(seoShop, shop?.categories ?? [], loaderData.product.categoryIds, {
                  name: loaderData.product.name,
                  url: productCanonical(seoShop.origin, seoShop.slug, loaderData.product.id),
                }),
              ),
            ),
          ]
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
  const { product: p, related, preview, course, waitlistUrl } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const shop = useLoaderData({ from: "/s/$slug" });
  const { locale, t } = useStorefrontLocale();
  const cart = useCart();
  const [img, setImg] = useState(0);
  const [variant, setVariant] = useState<string | null>(p.variants[0]?.id ?? null);
  const [msg, setMsg] = useState<string | null>(null);
  const chosen = p.variants.find((v) => v.id === variant) ?? null;
  const price = chosen ? chosen.price : p.price;
  const currency = chosen ? chosen.currency : p.currency;
  const tariff = course
    ? {
        homework: true,
        channel: true,
        accessDays: null,
        ...(chosen ? course.tariffs[chosen.id] : {}),
      }
    : null;
  const courseDate = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(locale), {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
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
      <Breadcrumbs slug={slug} shop={shop} categoryIds={p.categoryIds} leaf={p.name} t={t} />
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
          <div className="mt-3 text-2xl font-semibold">
            <OfferPrice
              price={price}
              oldPrice={chosen ? chosen.oldPrice : (p.offer?.oldPrice ?? null)}
              currency={currency}
              offer={p.offer}
            />
          </div>
          {p.offer && <OfferNote offer={p.offer} className="mt-1 block text-sm text-accent" />}
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
          {course && tariff && (
            <div className="mt-4 space-y-1 text-sm">
              {course.cohort && (
                <div className="font-medium">
                  {t("product.course.cohort", {
                    title: course.cohort.title,
                    date: courseDate(course.cohort.start),
                  })}
                </div>
              )}
              <div className="label">{t("product.course.includes")}</div>
              <ul className="space-y-0.5">
                {course.lessons.some((l) => l.homework) && (
                  <li>
                    {tariff.homework
                      ? t("product.course.incHomework")
                      : t("product.course.noHomework")}
                  </li>
                )}
                {course.channel && tariff.channel && <li>{t("product.course.incChannel")}</li>}
                <li>
                  {tariff.accessDays
                    ? t("product.course.access", { n: tariff.accessDays })
                    : t("product.course.accessForever")}
                </li>
              </ul>
            </div>
          )}
          <div className="mt-5 flex items-center gap-3">
            {course && !course.enrollOpen ? (
              <span className="badge">{t("product.course.closed")}</span>
            ) : p.inStock || p.preorder ? (
              <>
                <button className="btn-primary px-5 py-2.5 text-base" onClick={add}>
                  {t("product.addToCart")}
                </button>
                {!p.preorder && p.lowLeft !== null && (
                  <span className="badge" role="status">
                    {t("product.lowLeft", { n: p.lowLeft })}
                  </span>
                )}
                {p.preorder && (
                  <span className="badge">
                    {p.preorder.from
                      ? t("product.preorder", {
                          date: new Date(`${p.preorder.from}T12:00:00`).toLocaleDateString(
                            intlLocale(locale),
                            { day: "numeric", month: "long", year: "numeric" },
                          ),
                        })
                      : t("product.preorderNoDate")}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="badge">{t("product.outOfStock")}</span>
                {waitlistUrl && (
                  <a
                    href={waitlistUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary px-4 py-2"
                  >
                    {t("product.notify")}
                  </a>
                )}
              </>
            )}
            <FavoriteButton
              id={p.id}
              addLabel={t("fav.add")}
              removeLabel={t("fav.remove")}
              className="border border-line"
            />
            {msg && <span className="text-sm text-muted">{msg}</span>}
          </div>
          <ul className="mt-5 space-y-1.5 text-sm text-muted">
            {course ? (
              <li>{t("product.course.instant")}</li>
            ) : p.kind === "digital" ? (
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
      {course && (
        <section className="mt-10">
          <h2 className="mb-1 text-sm font-semibold">
            {t("product.course.program", { n: course.lessons.length })}
          </h2>
          <p className="mb-3 text-xs text-muted">
            {course.everyDays
              ? t("product.course.drip", { n: course.everyDays })
              : course.afterTask
                ? t(
                    course.afterTask === "submitted"
                      ? "product.course.afterSubmit"
                      : "product.course.afterAccept",
                  )
                : t("product.course.all")}
          </p>
          <ol className="space-y-1 text-sm">
            {course.lessons.map((l) => (
              <li key={l.no} className="flex gap-2">
                <span className="w-6 shrink-0 text-right text-muted tabular-nums">{l.no}.</span>
                <div className="min-w-0 flex-1">
                  <span>{l.title}</span>
                  {l.open && (
                    <details className="mt-1 rounded border border-line p-2">
                      <summary className="cursor-pointer text-xs">
                        🔓 {t("product.course.openLesson")}
                      </summary>
                      {l.open.text && (
                        <p className="mt-2 whitespace-pre-line text-sm">{l.open.text}</p>
                      )}
                      {l.open.link && (
                        <a
                          className="mt-2 block text-sm underline"
                          href={l.open.link}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          ▶️ {t("product.course.openLink")}
                        </a>
                      )}
                      {l.open.files.map((f) => (
                        <a
                          key={f.url}
                          className="mt-1 block text-sm underline"
                          href={f.url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          📎 {f.name}
                        </a>
                      ))}
                    </details>
                  )}
                </div>
                {l.homework && (
                  <span className="shrink-0 text-xs text-muted">📝 {t("product.course.hw")}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {preview.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-muted">{t("product.preview")}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {preview.map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="shrink-0">
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="h-56 rounded-md border border-line object-cover"
                />
              </a>
            ))}
          </div>
        </section>
      )}
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
