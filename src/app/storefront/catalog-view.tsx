import { Link, useLoaderData, useNavigate } from "@tanstack/react-router";
import { imageSrcSet } from "@/core/catalog/image-url";
import { cardBadge } from "@/core/catalog/lead-time";
import { useState, type MouseEvent, type ReactNode } from "react";
import { z } from "zod";
import { storeCatalogPageFn } from "@/app/storefront/catalog.functions";
import { storeShowcaseFn } from "@/app/storefront/showcase.functions";
import { ShowcaseBlocks } from "@/app/storefront/showcase";
import type { StoreProduct } from "@/core/storefront/catalog";
import { STORE_PAGE } from "@/core/storefront/paging";
import { useCart } from "@/app/storefront/cart";
import { FavoriteButton } from "@/app/storefront/favorites";
import { RecentlyViewed } from "@/app/storefront/recent";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { OfferNote, OfferPrice } from "@/app/storefront/offer";
import { SmartSearchResults } from "@/app/storefront/smart-search";
import { formatRatingSummary } from "@/core/reviews/pure";
import { formatMoney } from "@/core/money/money";
import { localeFlags } from "@/core/i18n/locale";
import { categoryChips } from "@/core/storefront/categories";
import { CATALOG_SORTS, parseCatalogSort } from "@/core/storefront/sort";
import { storefrontT } from "@/app/i18n/storefront";
import { shareText } from "@/core/storefront/share";
import {
  canonicalLink,
  breadcrumbJsonLd,
  categoryCanonical,
  categoryIndexable,
  jsonLdScript,
  pagedCanonical,
  shopCanonical,
  storefrontCrumbs,
} from "@/core/storefront/seo";
import { Breadcrumbs } from "@/app/storefront/breadcrumbs";
import type { Locale } from "@/core/i18n/locale";

/**
 * Каталог витрины: общая часть двух адресов — `/s/<магазин>` и `/s/<магазин>/c/<категория>`.
 * Категория в адресе пути — основная ссылка (её же отдаёт карта сайта); старый
 * `?category=` перенаправляется на неё. Фильтры (в наличии, цена, акция) и
 * поиск — в строке адреса обоих.
 */
export const catalogSearch = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  lang: z.string().max(5).optional(),
  // Сортировка как в Mini App v1; «catalog» (порядок продавца) в адрес не пишется.
  sort: z.enum(CATALOG_SORTS).optional().catch(undefined),
  // Страница каталога: «Показать ещё» — настоящая ссылка, без JS открывает следующую.
  page: z.number().int().min(2).max(200).optional().catch(undefined),
  // Фильтры: «в наличии» и цена от–до (core/storefront/filters), в запросе к базе.
  stock: z.literal(1).optional().catch(undefined),
  // «Со скидкой»: только товары с идущей акцией.
  sale: z.literal(1).optional().catch(undefined),
  // «Наборы»: только наборы товаров (модуль bundles).
  sets: z.literal(1).optional().catch(undefined),
  min: z.number().min(0).max(1_000_000_000).optional().catch(undefined),
  max: z.number().min(0).max(1_000_000_000).optional().catch(undefined),
});
export type CatalogSearch = z.infer<typeof catalogSearch>;

// Язык тоже на сервере: фильтр до деления на страницы, чипы — по всему каталогу.
export const catalogDeps = (search: CatalogSearch) => ({
  q: search.q,
  category: search.category,
  sort: search.sort,
  lang: search.lang,
  page: search.page,
  stock: search.stock,
  sale: search.sale,
  sets: search.sets,
  min: search.min,
  max: search.max,
});

export const loadCatalog = async (slug: string, deps: ReturnType<typeof catalogDeps>) => {
  const page = await storeCatalogPageFn({
    data: {
      slug,
      q: deps.q,
      category: deps.category,
      sort: deps.sort,
      lang: deps.lang,
      stock: deps.stock === 1 ? true : undefined,
      sale: deps.sale === 1 ? true : undefined,
      bundles: deps.sets === 1 ? true : undefined,
      min: deps.min,
      max: deps.max,
      offset: ((deps.page ?? 1) - 1) * STORE_PAGE,
    },
  });
  // Блоки главной (core/storefront/design) — только на «чистой» первой странице каталога.
  const plain =
    !deps.q &&
    !deps.category &&
    !deps.lang &&
    !deps.page &&
    !deps.stock &&
    !deps.sale &&
    !deps.sets &&
    deps.min === undefined &&
    deps.max === undefined;
  const sections = plain ? await storeShowcaseFn({ data: { slug } }) : [];
  return { ...page, sections };
};

type ShopHead = {
  slug: string;
  name: string;
  tagline: string | null;
  locale: Locale;
  categories: Array<{ id: string; name: string; parent_id: string | null }>;
  share: { origin: string; canonical: string; cover: string | null };
};

/** Заголовки, canonical, разметка крошек; пустая категория не попадает в поиск. */
export function catalogHead(
  matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>,
  search: CatalogSearch,
  itemCount: number | null,
) {
  const shop = matches.find((m) => (m.routeId as string) === "/s/$slug")?.loaderData as
    ShopHead | undefined;
  if (!shop) return {};
  // Поиск, сортировка и язык — та же страница: canonical без них; номер страницы — свой адрес.
  const page = search.page;
  const cat = search.category ? shop.categories.find((c) => c.id === search.category) : undefined;
  if (!cat)
    return {
      links: [canonicalLink(pagedCanonical(shopCanonical(shop.share.canonical, shop.slug), page))],
    };
  const title = `${cat.name} — ${shop.name}`;
  const description = shareText(
    [
      storefrontT(shop.locale)("meta.category", { category: cat.name, shop: shop.name }),
      shop.tagline,
    ]
      .filter(Boolean)
      .join(". "),
  );
  const url = pagedCanonical(categoryCanonical(shop.share.canonical, shop.slug, cat.id), page);
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      ...(categoryIndexable(itemCount) ? [] : [{ name: "robots", content: "noindex,follow" }]),
    ],
    links: [canonicalLink(url)],
    scripts: [
      jsonLdScript(
        breadcrumbJsonLd(
          storefrontCrumbs(
            { name: shop.name, slug: shop.slug, origin: shop.share.canonical },
            shop.categories,
            [cat.id],
          ),
        ),
      ),
    ],
  };
}

/** Ссылка внутри каталога: категория — в пути (`/c/<id>`), остальное — в строке адреса. */
function CatalogLink({
  slug,
  search,
  children,
  ...rest
}: {
  slug: string;
  search?: Partial<CatalogSearch>;
  children: ReactNode;
  className?: string;
  rel?: string;
  "aria-disabled"?: boolean;
  onClick?: (e: MouseEvent) => void;
}) {
  const { category, ...others } = search ?? {};
  return category ? (
    <Link to="/s/$slug/c/$category" params={{ slug, category }} search={others} {...rest}>
      {children}
    </Link>
  ) : (
    <Link to="/s/$slug" params={{ slug }} search={others} {...rest}>
      {children}
    </Link>
  );
}

export function CatalogView({
  first,
  slug,
  s,
}: {
  first: Awaited<ReturnType<typeof loadCatalog>>;
  slug: string;
  s: CatalogSearch;
}) {
  const shop = useLoaderData({ from: "/s/$slug" });
  const { t } = useStorefrontLocale();
  const navigate = useNavigate();
  const go = (search: CatalogSearch) => {
    const { category, ...others } = search;
    return category
      ? navigate({ to: "/s/$slug/c/$category", params: { slug, category }, search: others })
      : navigate({ to: "/s/$slug", params: { slug }, search: others });
  };
  const [q, setQ] = useState(s.q ?? "");
  const cart = useCart();
  const [added, setAdded] = useState<string | null>(null);
  // На телефоне фильтры — выезжающая снизу панель; на компьютере — строка над каталогом.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Догруженные «Показать ещё» страницы — для текущих поиска, категории и
  // сортировки; сменились они — начинаем с первой страницы из загрузчика.
  const pageKey = JSON.stringify([
    slug,
    s.q,
    s.category,
    s.sort,
    s.lang,
    s.page,
    s.stock,
    s.sale,
    s.sets,
    s.min,
    s.max,
  ]);
  const firstPage = s.page ?? 1;
  const [more, setMore] = useState<{
    key: string;
    items: StoreProduct[];
    hasMore: boolean;
  } | null>(null);
  const extra = more?.key === pageKey ? more : null;
  const catalog = extra ? [...first.items, ...extra.items] : first.items;
  const hasMore = extra ? extra.hasMore : first.hasMore;
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const loadMore = async () => {
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const next = await storeCatalogPageFn({
        data: {
          slug,
          q: s.q,
          category: s.category,
          sort: s.sort,
          lang: s.lang,
          stock: s.stock === 1 ? true : undefined,
          sale: s.sale === 1 ? true : undefined,
          bundles: s.sets === 1 ? true : undefined,
          min: s.min,
          max: s.max,
          offset: (firstPage - 1) * STORE_PAGE + catalog.length,
        },
      });
      const seen = new Set(catalog.map((p) => p.id));
      setMore({
        key: pageKey,
        items: [...(extra?.items ?? []), ...next.items.filter((p) => !seen.has(p.id))],
        hasMore: next.hasMore,
      });
    } catch {
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };
  // Ссылка «Показать ещё» ведёт на следующую ещё не показанную страницу.
  const nextPage = firstPage + Math.ceil(catalog.length / STORE_PAGE);
  // Корень выбранной ветки подсвечивается в верхнем ряду; второй ряд —
  // подкатегории выбранной (у листа — его соседи), товары подкатегорий
  // сервер уже включил в родительскую.
  const {
    roots: categories,
    current,
    path,
    active,
    subParent,
    subs,
  } = categoryChips(shop.categories, s.category, shop.catalogLayout);
  const langs = shop.langFilter ? first.languages : [];
  const lang = s.lang && langs.includes(s.lang as never) ? s.lang : null;
  const products = catalog;
  const filtered =
    s.stock === 1 || s.sale === 1 || s.sets === 1 || s.min !== undefined || s.max !== undefined;
  const sort = parseCatalogSort(s.sort);
  const digitalOnly = products.length > 0 && products.every((p) => p.kind === "digital");

  const home = !current && !s.q && !filtered && firstPage === 1;
  return (
    <>
      {home && shop.design.cover && shop.share.cover && (
        <div className="relative mb-6 overflow-hidden rounded-xl" data-testid="shop-cover">
          <img
            src={shop.share.cover}
            srcSet={imageSrcSet(shop.share.cover)}
            sizes="(min-width: 1152px) 1152px, 100vw"
            alt=""
            className="aspect-[3/1] w-full object-cover"
          />
          <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent p-4">
            <div className="text-white">
              <div className="text-xl font-semibold">{shop.name}</div>
              {shop.tagline && <div className="text-sm opacity-90">{shop.tagline}</div>}
            </div>
          </div>
        </div>
      )}
      {home && <ShowcaseBlocks slug={slug} sections={first.sections} />}
      {current && (
        <div className="mb-3">
          <Breadcrumbs slug={slug} shop={shop} categoryIds={[current.id]} t={t} />
        </div>
      )}
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
          {shop.quiz && !current && (
            <Link to="/s/$slug/quiz" params={{ slug }} className="btn-secondary mt-3 inline-flex">
              {t("quiz.link")}
            </Link>
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void go({ ...s, q: q || undefined, page: undefined });
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
          <CatalogLink
            slug={slug}
            search={{
              q: s.q,
              lang: s.lang,
              sort: s.sort,
              stock: s.stock,
              sale: s.sale,
              sets: s.sets,
              min: s.min,
              max: s.max,
            }}
            className={`badge shrink-0 px-3 py-1.5 ${!s.category ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            {t("catalog.all")}
          </CatalogLink>
          {categories.map((c) => (
            <CatalogLink
              key={c.id}
              slug={slug}
              search={{
                q: s.q,
                category: c.id,
                lang: s.lang,
                sort: s.sort,
                stock: s.stock,
                sale: s.sale,
                sets: s.sets,
                min: s.min,
                max: s.max,
              }}
              className={`badge shrink-0 px-3 py-1.5 ${active === c.id ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {c.name}
            </CatalogLink>
          ))}
        </div>
      )}

      {subs.length > 0 && subParent && (
        <div className="-mt-3 mb-6 flex gap-2 overflow-x-auto pb-1 text-sm">
          <CatalogLink
            slug={slug}
            search={{
              q: s.q,
              category: subParent,
              lang: s.lang,
              sort: s.sort,
              stock: s.stock,
              sale: s.sale,
              sets: s.sets,
              min: s.min,
              max: s.max,
            }}
            className={`badge shrink-0 px-3 py-1 ${s.category === subParent ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            {t("catalog.all")}
          </CatalogLink>
          {subs.map((c) => (
            <CatalogLink
              key={c.id}
              slug={slug}
              search={{
                q: s.q,
                category: c.id,
                lang: s.lang,
                sort: s.sort,
                stock: s.stock,
                sale: s.sale,
                sets: s.sets,
                min: s.min,
                max: s.max,
              }}
              className={`badge shrink-0 px-3 py-1 ${path.includes(c.id) ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {c.name}
            </CatalogLink>
          ))}
        </div>
      )}

      {langs.length > 0 && (
        <div className="-mt-3 mb-6 flex gap-2 overflow-x-auto pb-1 text-sm">
          <CatalogLink
            slug={slug}
            search={{ ...s, lang: undefined, page: undefined }}
            className={`badge shrink-0 px-3 py-1 ${!lang ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            {t("catalog.allLanguages")}
          </CatalogLink>
          {langs.map((l) => (
            <CatalogLink
              key={l}
              slug={slug}
              search={{ ...s, lang: l, page: undefined }}
              className={`badge shrink-0 px-3 py-1 ${lang === l ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {localeFlags[l]} {l === "kk" ? "KZ" : l.toUpperCase()}
            </CatalogLink>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-center gap-3 md:hidden">
        <button
          type="button"
          className="btn-secondary"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(true)}
        >
          ⚙️ {t("catalog.filters")}
          {filtered ? " •" : ""}
        </button>
        {filtered && (
          <CatalogLink
            slug={slug}
            search={{
              ...s,
              stock: undefined,
              sale: undefined,
              sets: undefined,
              min: undefined,
              max: undefined,
              page: undefined,
            }}
            className="text-sm text-accent hover:underline"
          >
            {t("catalog.filter.reset")}
          </CatalogLink>
        )}
      </div>
      {filtersOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          aria-hidden
          onClick={() => setFiltersOpen(false)}
        />
      )}
      <form
        className={`${
          filtersOpen
            ? "fixed inset-x-0 bottom-0 z-40 flex flex-col gap-3 rounded-t-2xl border-t border-line bg-surface p-4 pb-8 shadow-xl"
            : "hidden"
        } text-sm md:static md:z-auto md:-mt-3 md:mb-6 md:flex md:flex-row md:flex-wrap md:items-center md:gap-2 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none`}
        onSubmit={(e) => {
          e.preventDefault();
          setFiltersOpen(false);
          const f = new FormData(e.currentTarget);
          const num = (name: string) => {
            const v = String(f.get(name) ?? "")
              .trim()
              .replace(",", ".");
            return v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
          };
          void go({
            ...s,
            stock: f.get("stock") === "on" ? 1 : undefined,
            sale: f.get("sale") === "on" ? 1 : undefined,
            sets: f.get("sets") === "on" ? 1 : undefined,
            min: num("min"),
            max: num("max"),
            page: undefined,
          });
        }}
      >
        {shop.stockFilter && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="stock" defaultChecked={s.stock === 1} />
            {t("catalog.filter.stock")}
          </label>
        )}
        {(shop.saleFilter || s.sale === 1) && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="sale" defaultChecked={s.sale === 1} />
            {t("catalog.filter.sale")}
          </label>
        )}
        {(shop.bundleFilter || s.sets === 1) && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="sets" defaultChecked={s.sets === 1} />
            {t("catalog.filter.bundles")}
          </label>
        )}
        <label className="flex items-center gap-1.5">
          {t("catalog.filter.priceFrom")}
          <input
            className="input w-24 py-1"
            name="min"
            inputMode="decimal"
            defaultValue={s.min ?? ""}
          />
        </label>
        <label className="flex items-center gap-1.5">
          {t("catalog.filter.priceTo")}
          <input
            className="input w-24 py-1"
            name="max"
            inputMode="decimal"
            defaultValue={s.max ?? ""}
          />
        </label>
        <button className="btn-secondary shrink-0 px-3 py-1">{t("catalog.filter.apply")}</button>
        <button
          type="button"
          className="btn-secondary shrink-0 px-3 py-1 md:hidden"
          onClick={() => setFiltersOpen(false)}
        >
          {t("catalog.filters.close")}
        </button>
        {filtered && (
          <CatalogLink
            slug={slug}
            search={{
              ...s,
              stock: undefined,
              sale: undefined,
              sets: undefined,
              min: undefined,
              max: undefined,
              page: undefined,
            }}
            className="text-accent hover:underline"
          >
            {t("catalog.filter.reset")}
          </CatalogLink>
        )}
      </form>

      {catalog.length > 1 && (
        <div className="-mt-3 mb-6 flex gap-2 overflow-x-auto pb-1 text-sm">
          {CATALOG_SORTS.map((k) => (
            <CatalogLink
              key={k}
              slug={slug}
              search={{ ...s, sort: k === "catalog" ? undefined : k, page: undefined }}
              aria-current={sort === k ? "page" : undefined}
              className={`badge shrink-0 px-3 py-1 ${sort === k ? "border-accent bg-accent/10 text-accent" : ""}`}
            >
              {t(`catalog.sort.${k}`)}
            </CatalogLink>
          ))}
        </div>
      )}

      {products.length === 0 ? (
        <>
          <div className="rounded-lg border border-dashed border-line px-4 py-16 text-center">
            <div className="text-3xl">🛍</div>
            <p className="mt-3 font-medium">
              {s.q || filtered ? t("catalog.nothingFound") : t("catalog.filling")}
            </p>
            <p className="mt-1 text-sm text-muted">
              {s.q || filtered ? t("catalog.tryAnother") : t("catalog.comeLater")}
            </p>
            {s.q && (
              <CatalogLink slug={slug} className="btn-secondary mt-4">
                {t("catalog.allProducts")}
              </CatalogLink>
            )}
          </div>
          {s.q && !filtered && !s.category && !s.lang && firstPage === 1 && (
            <SmartSearchResults slug={slug} q={s.q} />
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p, i) => (
            <article
              key={p.id}
              className="card group relative flex flex-col overflow-hidden transition-shadow hover:shadow-md"
            >
              <Link to="/s/$slug/p/$id" params={{ slug, id: p.id }} className="relative block">
                {p.images[0] ? (
                  <img
                    src={p.images[0]}
                    srcSet={imageSrcSet(p.images[0])}
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    alt={p.name}
                    width={640}
                    height={640}
                    className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02]"
                    // Первый ряд грузится сразу (это первая отрисовка), остальное — по мере прокрутки.
                    loading={i < 4 ? "eager" : "lazy"}
                    decoding="async"
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
                {p.bundle && (
                  <span className="absolute bottom-2 left-2 rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-white">
                    {t("catalog.bundle")}
                  </span>
                )}
                {!p.inStock && (
                  <span className="absolute right-2 bottom-2 rounded-md bg-fg/80 px-2 py-0.5 text-[11px] font-medium text-bg">
                    {p.preorder ? t("catalog.preorder") : t("catalog.outOfStock")}
                  </span>
                )}
              </Link>
              <FavoriteButton
                id={p.id}
                addLabel={t("fav.add")}
                removeLabel={t("fav.remove")}
                className="absolute top-2 right-2"
              />
              <div className="flex flex-1 flex-col p-3">
                <Link
                  to="/s/$slug/p/$id"
                  params={{ slug, id: p.id }}
                  className="line-clamp-2 text-sm font-medium hover:underline"
                >
                  {p.name}
                </Link>
                {p.bundle && (
                  <div className="mt-1 text-xs text-muted">
                    {p.bundle.available
                      ? p.bundle.saving !== null
                        ? t("bundle.saving", {
                            saving: formatMoney(p.bundle.saving, p.currency),
                            separate: formatMoney(p.bundle.separateTotal ?? 0, p.currency),
                          })
                        : t("bundle.partsCount", { n: p.bundle.parts.length })
                      : t("bundle.unavailable")}
                  </div>
                )}
                {p.rating && (
                  <div className="mt-1 text-xs text-muted">
                    {formatRatingSummary(p.rating.avg, p.rating.count)}
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                  <span className="text-sm font-semibold">
                    <OfferPrice
                      price={p.price}
                      oldPrice={p.offer?.oldPrice ?? null}
                      currency={p.currency}
                      offer={p.offer}
                      label={(price) => (p.priceFrom ? t("catalog.priceFrom", { price }) : price)}
                    />
                    {p.offer && (
                      <OfferNote
                        offer={p.offer}
                        className="block text-[11px] font-normal text-muted"
                      />
                    )}
                  </span>
                  {!p.inStock && !p.preorder ? null : p.variants.length > 0 ? (
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
      {(hasMore || firstPage > 1) && (
        <div className="mt-6 flex flex-col items-center gap-3">
          {hasMore && (
            <CatalogLink
              slug={slug}
              search={{ ...s, page: nextPage }}
              className={`btn-secondary ${loadingMore ? "pointer-events-none opacity-60" : ""}`}
              aria-disabled={loadingMore}
              onClick={(e) => {
                // С JS — догружаем на месте; без JS ссылка откроет следующую страницу.
                e.preventDefault();
                if (!loadingMore) void loadMore();
              }}
            >
              {t("catalog.loadMore")}
            </CatalogLink>
          )}
          {moreFailed && (
            <p role="alert" className="text-sm text-danger">
              {t("catalog.loadMoreFailed")}
            </p>
          )}
          {firstPage > 1 && (
            <CatalogLink
              slug={slug}
              search={{ ...s, page: undefined }}
              className="text-sm text-muted hover:text-fg"
            >
              {t("catalog.firstPage")}
            </CatalogLink>
          )}
        </div>
      )}
      <RecentlyViewed slug={slug} />
      {added === "mixed" && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-fg px-4 py-2 text-sm text-bg shadow">
          {t("catalog.mixed")}
        </div>
      )}
    </>
  );
}
