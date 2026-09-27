import { createFileRoute, Link, useLoaderData, useNavigate } from "@tanstack/react-router";
import { cardBadge } from "@/core/catalog/lead-time";
import { useState } from "react";
import { z } from "zod";
import { storeCatalogFn } from "@/app/storefront/storefront.functions";
import { useCart } from "@/app/storefront/cart";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { formatMoney } from "@/core/money/money";
import { localeFlags } from "@/core/i18n/locale";
import { filterByLanguage, languageChips } from "@/core/storefront/lang-filter";

export const Route = createFileRoute("/s/$slug/")({
  validateSearch: z.object({
    q: z.string().optional(),
    category: z.string().optional(),
    lang: z.string().max(5).optional(),
  }),
  // Язык фильтруется в браузере: смена чипа не перезапрашивает каталог.
  loaderDeps: ({ search }) => ({ q: search.q, category: search.category }),
  loader: ({ params, deps }) =>
    storeCatalogFn({ data: { slug: params.slug, q: deps.q, category: deps.category } }),
  component: CatalogPage,
});

function CatalogPage() {
  const catalog = Route.useLoaderData();
  const { slug } = Route.useParams();
  const shop = useLoaderData({ from: "/s/$slug" });
  const { t } = useStorefrontLocale();
  const all = shop.categories;
  const categories = all.filter((c) => !c.parent_id);
  const s = Route.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState(s.q ?? "");
  const cart = useCart();
  const [added, setAdded] = useState<string | null>(null);
  const current = all.find((c) => c.id === s.category);
  // Корень выбранной ветки подсвечивается в верхнем ряду; второй ряд —
  // подкатегории выбранной (у листа — его соседи), товары подкатегорий
  // сервер уже включил в родительскую.
  const path: string[] = [];
  for (let c = current; c && !path.includes(c.id); c = all.find((x) => x.id === c!.parent_id))
    path.unshift(c.id);
  const children = (id: string) => all.filter((c) => c.parent_id === id);
  const subParent = current ? (children(current.id).length ? current.id : current.parent_id) : null;
  const subs = subParent ? children(subParent) : [];
  const langs = shop.langFilter ? languageChips(catalog) : [];
  const lang = s.lang && langs.includes(s.lang as never) ? s.lang : null;
  const products = filterByLanguage(catalog, lang);
  const digitalOnly = products.length > 0 && products.every((p) => p.kind === "digital");

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{current ? current.name : t("catalog.title")}</h1>
          <p className="mt-1 text-sm text-muted">
            {s.q
              ? t("catalog.searchFor", { q: s.q })
              : digitalOnly
                ? t("catalog.digitalIntro")
                : t("catalog.intro")}
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void navigate({
              to: "/s/$slug",
              params: { slug },
              search: { ...s, q: q || undefined },
            });
          }}
        >
          <input
            className="input md:w-64"
            placeholder={t("catalog.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-secondary shrink-0">{t("catalog.search")}</button>
        </form>
      </div>

      {categories.length > 0 && (
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
          <Link
            to="/s/$slug"
            params={{ slug }}
            search={{ q: s.q, lang: s.lang }}
            className={`badge shrink-0 px-3 py-1.5 ${!s.category ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            {t("catalog.all")}
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              to="/s/$slug"
              params={{ slug }}
              search={{ q: s.q, category: c.id, lang: s.lang }}
              className={`badge shrink-0 px-3 py-1.5 ${path[0] === c.id ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {subs.length > 0 && subParent && (
        <div className="-mt-3 mb-6 flex gap-2 overflow-x-auto pb-1 text-sm">
          <Link
            to="/s/$slug"
            params={{ slug }}
            search={{ q: s.q, category: subParent, lang: s.lang }}
            className={`badge shrink-0 px-3 py-1 ${s.category === subParent ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            {t("catalog.all")}
          </Link>
          {subs.map((c) => (
            <Link
              key={c.id}
              to="/s/$slug"
              params={{ slug }}
              search={{ q: s.q, category: c.id, lang: s.lang }}
              className={`badge shrink-0 px-3 py-1 ${path.includes(c.id) ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {langs.length > 0 && (
        <div className="-mt-3 mb-6 flex gap-2 overflow-x-auto pb-1 text-sm">
          <Link
            to="/s/$slug"
            params={{ slug }}
            search={{ ...s, lang: undefined }}
            className={`badge shrink-0 px-3 py-1 ${!lang ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            {t("catalog.allLanguages")}
          </Link>
          {langs.map((l) => (
            <Link
              key={l}
              to="/s/$slug"
              params={{ slug }}
              search={{ ...s, lang: l }}
              className={`badge shrink-0 px-3 py-1 ${lang === l ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {localeFlags[l]} {l === "kk" ? "KZ" : l.toUpperCase()}
            </Link>
          ))}
        </div>
      )}

      {products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-16 text-center">
          <div className="text-3xl">🛍</div>
          <p className="mt-3 font-medium">
            {s.q ? t("catalog.nothingFound") : t("catalog.filling")}
          </p>
          <p className="mt-1 text-sm text-muted">
            {s.q ? t("catalog.tryAnother") : t("catalog.comeLater")}
          </p>
          {s.q && (
            <Link to="/s/$slug" params={{ slug }} className="btn-secondary mt-4">
              {t("catalog.allProducts")}
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <article
              key={p.id}
              className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-md"
            >
              <Link to="/s/$slug/p/$id" params={{ slug, id: p.id }} className="relative block">
                {p.images[0] ? (
                  <img
                    src={p.images[0]}
                    alt={p.name}
                    className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-surface-2 text-4xl">
                    {p.kind === "digital" ? "📄" : "📦"}
                  </div>
                )}
                <span className="absolute top-2 left-2 rounded-md bg-surface/90 px-2 py-0.5 text-[11px] font-medium backdrop-blur">
                  {(() => {
                    const b = cardBadge(p);
                    return b.key === "catalog.madeToOrder" ? t(b.key, { n: b.n }) : t(b.key);
                  })()}
                </span>
                {!p.inStock && (
                  <span className="absolute top-2 right-2 rounded-md bg-fg/80 px-2 py-0.5 text-[11px] font-medium text-bg">
                    {t("catalog.outOfStock")}
                  </span>
                )}
              </Link>
              <div className="flex flex-1 flex-col p-3">
                <Link
                  to="/s/$slug/p/$id"
                  params={{ slug, id: p.id }}
                  className="line-clamp-2 text-sm font-medium hover:underline"
                >
                  {p.name}
                </Link>
                {p.rating && (
                  <div className="mt-1 text-xs text-muted">
                    ★ {p.rating.avg.toFixed(1)} · {p.rating.count}
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                  <span className="text-sm font-semibold tabular-nums">
                    {p.priceFrom
                      ? t("catalog.priceFrom", { price: formatMoney(p.price, p.currency) })
                      : formatMoney(p.price, p.currency)}
                  </span>
                  {!p.inStock ? null : p.variants.length > 0 ? (
                    <Link
                      to="/s/$slug/p/$id"
                      params={{ slug, id: p.id }}
                      className="btn-secondary px-2.5 py-1 text-xs"
                    >
                      {t("catalog.choose")}
                    </Link>
                  ) : (
                    <button
                      className="btn-primary px-2.5 py-1 text-xs"
                      onClick={() => {
                        const r = cart.add({
                          productId: p.id,
                          variantId: null,
                          name: p.name,
                          price: p.price,
                          currency: p.currency,
                          image: p.images[0] ?? null,
                          kind: p.kind,
                        });
                        setAdded(r === "ok" ? p.id : "mixed");
                        setTimeout(() => setAdded(null), 1500);
                      }}
                    >
                      {added === p.id ? t("catalog.added") : t("catalog.addToCart")}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {added === "mixed" && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-fg px-4 py-2 text-sm text-bg shadow">
          {t("catalog.mixed")}
        </div>
      )}
    </>
  );
}
