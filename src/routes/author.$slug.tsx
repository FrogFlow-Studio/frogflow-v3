import { publicHeaders } from "@/app/cache-policy";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { authorPageFn } from "@/app/community-author/author.functions";
import { authorT } from "@/app/community-author/i18n";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { formatMoney } from "@/core/money/money";

/** Публичная страница автора (С6): профиль, «Что продаю», оценка, взаимные рекомендации. Без входа. */
export const Route = createFileRoute("/author/$slug")({
  headers: publicHeaders,
  validateSearch: z.object({ lang: z.enum(SUPPORTED_LOCALES).optional().catch(undefined) }),
  loader: ({ params }) => authorPageFn({ data: { slug: params.slug } }),
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const t = authorT(match.search.lang ?? "ru");
    return {
      meta: [
        { title: t("meta.title", { name: loaderData.card.name }) },
        { name: "description", content: t("meta.description", { name: loaderData.card.name }) },
      ],
    };
  },
  component: AuthorPage,
});

function AuthorPage() {
  const a = Route.useLoaderData();
  const search = Route.useSearch();
  const locale: Locale = search.lang ?? "ru";
  const t = authorT(locale);
  const lang = search.lang;
  const where = [a.card.niche || a.category, a.card.city].filter(Boolean).join(", ");
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" search={lang ? { lang } : {}} className="text-lg font-semibold">
          🐸 FrogFlow
        </Link>
        <nav className="flex gap-2 text-sm">
          {SUPPORTED_LOCALES.map((l) => (
            <Link
              key={l}
              to="/author/$slug"
              params={{ slug: a.slug }}
              search={{ lang: l }}
              className={l === locale ? "font-medium" : "text-muted"}
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
      <h1 className="mt-6 text-2xl font-semibold" data-testid="author-name">
        {a.card.name}
      </h1>
      {where && <p className="mt-1 text-sm text-muted">{where}</p>}
      {a.rating ? (
        <p className="mt-3 text-sm" data-testid="author-rating">
          {t("rating", { rating: a.rating.value.toFixed(1), count: a.rating.count })}
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted">{t("rating.none")}</p>
      )}
      {a.card.about && (
        <section className="mt-6">
          <h2 className="font-medium">{t("about")}</h2>
          <p className="mt-1 whitespace-pre-line text-sm">{a.card.about}</p>
        </section>
      )}
      <section className="mt-6">
        <h2 className="font-medium">{t("sells")}</h2>
        {a.items.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{t("sells.empty")}</p>
        ) : (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {a.items.map((p) => (
              <li key={p.id} className="card flex justify-between gap-3 p-3 text-sm">
                <span>{p.name}</span>
                <span className="text-muted">
                  {p.priceFrom ? "от " : ""}
                  {formatMoney(p.price, p.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {a.hasMoreItems && <p className="mt-2 text-xs text-muted">{t("sells.more")}</p>}
        {a.storefront && (
          <a href={`/s/${a.slug}`} className="mt-3 inline-block text-sm font-medium underline">
            {t("open")}
          </a>
        )}
      </section>
      {a.card.links.length > 0 && (
        <section className="mt-6">
          <h2 className="font-medium">{t("links")}</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {a.card.links.map((l) => (
              <li key={l}>
                <a
                  href={l}
                  rel="nofollow noopener noreferrer"
                  target="_blank"
                  className="underline"
                >
                  {l}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.recommended.length > 0 && (
        <section className="mt-6" data-testid="author-recommended">
          <h2 className="font-medium">{t("recommends")}</h2>
          <p className="text-xs text-muted">{t("recommends.hint")}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {a.recommended.map((r) => (
              <li key={r.slug}>
                <Link to="/author/$slug" params={{ slug: r.slug }} className="underline">
                  {r.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
