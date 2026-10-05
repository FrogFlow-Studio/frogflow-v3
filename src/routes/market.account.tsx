import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { marketAccountFn, marketLogoutFn } from "@/app/market/buyer.functions";
import { favoriteT } from "@/app/market/favorite-i18n";
import { marketT } from "@/app/market/i18n";
import { MarketReorderButton } from "@/app/market/reorder-button";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/** «Мои заказы во всех магазинах» (В17): вход только через магазин, площадка его запоминает. */
export const Route = createFileRoute("/market/account")({
  validateSearch: z.object({ lang: z.enum(SUPPORTED_LOCALES).optional().catch(undefined) }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => marketAccountFn({ data: { lang: deps.lang } }),
  head: ({ match }) => {
    const t = marketT(match.search.lang ?? "ru");
    return { meta: [{ title: t("acc.meta") }, { name: "robots", content: "noindex" }] };
  },
  component: AccountPage,
});

function AccountPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const locale: Locale = search.lang ?? "ru";
  const t = marketT(locale);
  const ft = favoriteT(locale);
  const lang = search.lang;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
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
              to="/market/account"
              search={{ lang: l }}
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
        <span className="font-medium">{t("tab.orders")}</span>
      </nav>
      <h1 className="mt-4 text-2xl font-semibold">{t("acc.title")}</h1>
      {!data.ready ? (
        <p className="mt-4 text-sm text-muted">{t("acc.soon")}</p>
      ) : !data.signedIn ? (
        <p className="mt-4 text-sm text-muted">{t("acc.signin")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">{t("acc.hint")}</p>
          <ul className="mt-6 grid gap-3">
            {data.shops.map((s) => (
              <li key={s.slug} className="card p-4">
                <h2 className="font-medium">{s.name}</h2>
                {s.orders.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{t("acc.noorders")}</p>
                ) : (
                  <ul className="mt-2 grid gap-1 text-sm">
                    {s.orders.map((o) => (
                      <li key={o.no}>
                        {t("acc.order", { no: o.no })} · {o.status} ·{" "}
                        {new Intl.NumberFormat(locale).format(o.total)} {o.currency} ·{" "}
                        {date.format(new Date(o.at))}
                        <MarketReorderButton slug={s.slug} orderId={o.id} locale={locale} />
                      </li>
                    ))}
                  </ul>
                )}
                {s.favorites.length > 0 && (
                  <div className="mt-3">
                    <h3 className="text-sm font-medium">{t("acc.favorites")}</h3>
                    <ul className="mt-1 grid gap-1 text-sm">
                      {s.favorites.map((f) => (
                        <li key={f.id}>
                          <Link
                            to="/s/$slug/p/$id"
                            params={{ slug: s.slug, id: f.id }}
                            className="underline"
                          >
                            {f.name}
                          </Link>{" "}
                          · {new Intl.NumberFormat(locale).format(f.price)} {f.currency}
                        </li>
                      ))}
                    </ul>
                    {s.moreFavorites > 0 && (
                      <p className="mt-1 text-xs text-muted">
                        {t("acc.moreFavorites", { n: s.moreFavorites })}
                      </p>
                    )}
                  </div>
                )}
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
          <section className="card mt-6 p-4" aria-labelledby="fav-title">
            <h2 id="fav-title" className="font-medium">
              {ft("title")}
            </h2>
            {!data.favorites.ready ? (
              <p className="mt-2 text-sm text-muted">{ft("soon")}</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted">{ft("hint")}</p>
                {data.favorites.items.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{ft("empty")}</p>
                ) : (
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                    {data.favorites.items.map((f) => (
                      <li key={`${f.shopId}:${f.id}`} className="flex gap-3 text-sm">
                        {f.image && (
                          <img
                            src={f.image}
                            alt=""
                            loading="lazy"
                            className="h-12 w-12 rounded object-cover"
                          />
                        )}
                        <div className="min-w-0">
                          <Link
                            to="/s/$slug/p/$id"
                            params={{ slug: f.shopSlug, id: f.id }}
                            className="font-medium underline"
                          >
                            {f.name}
                          </Link>
                          <p>
                            {new Intl.NumberFormat(locale).format(f.price)} {f.currency}
                          </p>
                          <p className="text-xs text-muted">{f.shopName}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {data.favorites.gone > 0 && (
                  <p className="mt-2 text-xs text-muted">
                    {ft("gone", { n: data.favorites.gone })}
                  </p>
                )}
              </>
            )}
          </section>
          {data.addresses.length > 0 && (
            <section className="card mt-6 p-4">
              <h2 className="font-medium">{t("acc.addresses")}</h2>
              <p className="mt-1 text-xs text-muted">{t("acc.addressesHint")}</p>
              <ul className="mt-2 grid gap-1 text-sm">
                {data.addresses.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              {data.moreAddresses > 0 && (
                <p className="mt-1 text-xs text-muted">
                  {t("acc.moreAddresses", { n: data.moreAddresses })}
                </p>
              )}
            </section>
          )}
          {data.moreShops > 0 && (
            <p className="mt-4 text-sm text-muted">{t("acc.more", { n: data.moreShops })}</p>
          )}
          <button
            type="button"
            className="btn mt-6"
            onClick={async () => {
              await marketLogoutFn();
              await router.invalidate();
            }}
          >
            {t("acc.logout")}
          </button>
        </>
      )}
    </main>
  );
}
