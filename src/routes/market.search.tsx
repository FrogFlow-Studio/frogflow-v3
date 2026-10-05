import { FilterForm } from "@/app/market/filter-form";
import { publicHeaders } from "@/app/cache-policy";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { rememberMarketBack } from "@/app/market/back";
import { marketT } from "@/app/market/i18n";
import { marketSearchFn } from "@/app/market/search.functions";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/** Поиск товаров по всем магазинам площадки (В8). Без входа. */
export const Route = createFileRoute("/market/search")({
  headers: publicHeaders,
  validateSearch: z.object({
    lang: z.enum(SUPPORTED_LOCALES).optional().catch(undefined),
    q: z.string().max(80).optional().catch(undefined),
    category: z.string().max(60).optional().catch(undefined),
    offset: z.number().int().min(0).optional().catch(undefined),
    fuzzy: z.boolean().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    marketSearchFn({
      data: { q: deps.q, category: deps.category, offset: deps.offset, fuzzy: deps.fuzzy },
    }),
  head: ({ match }) => {
    const t = marketT(match.search.lang ?? "ru");
    return { meta: [{ title: t("items.meta") }, { name: "robots", content: "noindex" }] };
  },
  component: MarketSearchPage,
  errorComponent: SearchFailed,
});

/** Чтение упало: честно «не удалось загрузить», а не «ничего не нашли» (Л1). */
function SearchFailed() {
  const { lang } = useSearch({ strict: false }) as { lang?: Locale };
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p role="alert" className="text-sm">
        {marketT(lang ?? "ru")("items.failed")}
      </p>
    </main>
  );
}

/** «в магазине {имя}»: имя автора ведёт в его витрину, остальной текст по языку (П1). */
function ItemAuthor({
  text,
  slug,
  name,
  onOpen,
}: {
  text: string;
  slug: string;
  name: string;
  onOpen: () => void;
}) {
  const [before = "", after = ""] = text.split("\u0000");
  return (
    <>
      {before}
      <Link to="/s/$slug" params={{ slug }} className="underline" onClick={onOpen}>
        {name}
      </Link>
      {after}
    </>
  );
}

function MarketSearchPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const locale: Locale = search.lang ?? "ru";
  const t = marketT(locale);
  const lang = search.lang;
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" search={lang ? { lang } : {}} className="text-lg font-semibold">
          🐸 FrogFlow
        </Link>
        <nav className="flex gap-2 text-sm">
          {SUPPORTED_LOCALES.map((l) => (
            <Link
              key={l}
              to="/market/search"
              search={{ ...search, lang: l }}
              className={l === locale ? "font-medium" : "text-muted"}
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
      <nav className="mt-4 flex gap-4 text-sm">
        <Link to="/market" search={lang ? { lang } : {}} className="underline">
          {t("tab.shops")}
        </Link>
        <span className="font-medium">{t("tab.items")}</span>
      </nav>
      <h1 className="mt-4 text-2xl font-semibold">{t("items.title")}</h1>
      {!data.ready ? (
        <p className="mt-4 text-sm text-muted">{t("soon")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">{t("items.lead")}</p>
          <FilterForm
            action="/market/search"
            openLabel={t("filter.open")}
            closeLabel={t("filter.apply")}
          >
            {lang && <input type="hidden" name="lang" value={lang} />}
            <label className="text-sm">
              <span className="block text-muted">{t("items.label")}</span>
              <input
                name="q"
                defaultValue={search.q ?? ""}
                maxLength={80}
                placeholder={t("items.placeholder")}
                className="input mt-1"
              />
            </label>
            <label className="text-sm">
              <span className="block text-muted">{t("filter.category")}</span>
              <select name="category" defaultValue={search.category ?? ""} className="input mt-1">
                <option value="">{t("filter.all")}</option>
                {data.categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.value} ({c.count})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn">
              {t("search.button")}
            </button>
          </FilterForm>
          {data.words.length === 0 && !search.category ? (
            <p className="mt-6 text-sm text-muted">{t("items.hint")}</p>
          ) : data.items.length === 0 ? (
            <p className="mt-6 text-sm text-muted">{t("items.empty")}</p>
          ) : (
            <>
              {data.fuzzy && (
                <p className="mt-6 text-sm text-muted" data-testid="items-fuzzy">
                  {t("items.fuzzy")}
                </p>
              )}
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {data.items.map((i) => (
                  <li key={`${i.shopId}:${i.id}`} className="card flex gap-3 p-4">
                    {i.image && (
                      <img
                        src={i.image}
                        alt=""
                        loading="lazy"
                        className="h-16 w-16 rounded object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <h2 className="font-medium">{i.name}</h2>
                      <p className="text-sm">
                        {new Intl.NumberFormat(locale).format(i.price)} {i.currency}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        <ItemAuthor
                          text={t("items.in", { shop: "\u0000" })}
                          slug={i.shopSlug}
                          name={i.shopName}
                          onOpen={() => rememberMarketBack(i.shopSlug, "/market/search", search)}
                        />
                      </p>
                      <Link
                        to="/s/$slug"
                        params={{ slug: i.shopSlug }}
                        className="mt-2 inline-block text-sm font-medium underline"
                        onClick={() => rememberMarketBack(i.shopSlug, "/market/search", search)}
                      >
                        {t("items.open")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.next != null && (
            <div className="mt-6 text-sm">
              <Link
                to="/market/search"
                search={{ ...search, offset: data.next, fuzzy: data.fuzzy || undefined }}
                className="underline"
              >
                {t("next")}
              </Link>
            </div>
          )}
        </>
      )}
    </main>
  );
}
