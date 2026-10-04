import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { marketFn } from "@/app/market/market.functions";
import { marketHeadLinks } from "@/app/market/seo";
import { marketT } from "@/app/market/i18n";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/** Площадка FrogFlow: каталог магазинов, согласившихся показываться (В7). Без входа. */
export const Route = createFileRoute("/market/")({
  validateSearch: z.object({
    lang: z.enum(SUPPORTED_LOCALES).optional().catch(undefined),
    category: z.string().max(60).optional().catch(undefined),
    city: z.string().max(60).optional().catch(undefined),
    q: z.string().max(60).optional().catch(undefined),
    offset: z.number().int().min(0).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    marketFn({
      data: { category: deps.category, city: deps.city, q: deps.q, offset: deps.offset },
    }),
  head: ({ match }) => {
    const t = marketT(match.search.lang ?? "ru");
    return {
      meta: [{ title: t("meta.title") }, { name: "description", content: t("meta.description") }],
      // Фильтры и постраничный показ — та же страница: canonical без них, только язык (В10).
      links: marketHeadLinks("/market", match.search.lang ?? "ru"),
    };
  },
  component: MarketPage,
});

function MarketPage() {
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
              to="/market"
              search={{ ...search, lang: l }}
              className={l === locale ? "font-medium" : "text-muted"}
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
      <nav className="mt-4 flex gap-4 text-sm">
        <span className="font-medium">{t("tab.shops")}</span>
        <Link to="/market/search" search={lang ? { lang } : {}} className="underline">
          {t("tab.items")}
        </Link>
      </nav>
      <h1 className="mt-4 text-2xl font-semibold">{t("title")}</h1>
      {!data.ready ? (
        <p className="mt-4 text-sm text-muted">{t("soon")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">{t("lead")}</p>
          <form method="get" action="/market" className="mt-5 flex flex-wrap items-end gap-3">
            {lang && <input type="hidden" name="lang" value={lang} />}
            <label className="text-sm">
              <span className="block text-muted">{t("search.label")}</span>
              <input
                name="q"
                defaultValue={search.q ?? ""}
                maxLength={60}
                placeholder={t("search.placeholder")}
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
            <label className="text-sm">
              <span className="block text-muted">{t("filter.city")}</span>
              <select name="city" defaultValue={search.city ?? ""} className="input mt-1">
                <option value="">{t("filter.all")}</option>
                {data.cities.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.value} ({c.count})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn">
              {t("search.button")}
            </button>
          </form>
          {data.shops.length === 0 ? (
            <p className="mt-6 text-sm text-muted">{t("empty")}</p>
          ) : (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {data.shops.map((s) => (
                <li key={s.id} className="card p-4">
                  <h2 className="font-medium">{s.name}</h2>
                  <p className="mt-0.5 text-xs text-muted">
                    {[s.category, s.city].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-2 text-sm">
                    {s.rating == null
                      ? t("rating.none")
                      : t("rating.count", { rating: s.rating.toFixed(1), count: s.ratingCount })}
                  </p>
                  <Link
                    to="/s/$slug"
                    params={{ slug: s.slug }}
                    className="mt-3 inline-block text-sm font-medium underline"
                  >
                    {t("shop.open")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex gap-4 text-sm">
            {(search.offset ?? 0) > 0 && (
              <Link to="/market" search={{ ...search, offset: undefined }} className="underline">
                {t("first")}
              </Link>
            )}
            {data.next != null && (
              <Link to="/market" search={{ ...search, offset: data.next }} className="underline">
                {t("next")}
              </Link>
            )}
          </div>
        </>
      )}
    </main>
  );
}
