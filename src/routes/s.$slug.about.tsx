import { publicHeaders } from "@/app/cache-policy";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { storeAboutPageFn } from "@/app/storefront/about.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { aboutCanonical, aboutJsonLd } from "@/core/storefront/about";
import { canonicalLink, jsonLdScript } from "@/core/storefront/seo";
import { shareText } from "@/core/storefront/share";

export const Route = createFileRoute("/s/$slug/about")({
  headers: publicHeaders,
  loader: ({ params }) => storeAboutPageFn({ data: { slug: params.slug } }),
  head: ({ loaderData, matches, params }) => {
    const shop = matches.find((m) => (m.routeId as string) === "/s/$slug")?.loaderData as
      | {
          name: string;
          botUsername: string | null;
          contactLink: string | null;
          share: { origin: string; cover: string | null };
        }
      | undefined;
    if (!shop || !loaderData) return {};
    const a = loaderData.about;
    const origin = shop.share.origin;
    const description = shareText(a.description || loaderData.legalAbout || shop.name);
    const url = aboutCanonical(origin, params.slug);
    const links = [shop.contactLink, shop.botUsername ? `https://t.me/${shop.botUsername}` : null];
    return {
      meta: [
        { title: shop.name },
        { name: "description", content: description },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
      ],
      links: [canonicalLink(url)],
      scripts: [
        jsonLdScript(
          aboutJsonLd(
            { name: shop.name, slug: params.slug, origin, cover: shop.share.cover },
            a,
            links.filter((l): l is string => Boolean(l)),
          ),
        ),
      ],
    };
  },
  component: AboutPage,
});

function AboutPage() {
  const { about: a, legalAbout, reviews } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const shop = useLoaderData({ from: "/s/$slug" });
  const { t } = useStorefrontLocale();
  const write = shop.contactLink ?? (shop.botUsername ? `https://t.me/${shop.botUsername}` : null);
  const description = a.description || legalAbout;
  const rows: Array<[string, string]> = (
    [
      ["about.phone", a.phone],
      ["about.address", a.address],
      ["about.hours", a.hours],
    ] as const
  ).filter(([, v]) => v) as Array<[string, string]>;
  return (
    <article className="mx-auto max-w-2xl">
      <Link to="/s/$slug" params={{ slug }} className="text-sm text-muted hover:underline">
        {t("legal.back")}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">{t("about.title")}</h1>
      {description && (
        <p className="mt-4 text-sm leading-relaxed whitespace-pre-line">{description}</p>
      )}
      {(rows.length > 0 || write) && (
        <section className="mt-6" data-testid="about-contacts">
          <h2 className="mb-2 text-sm font-semibold">{t("about.contacts")}</h2>
          <dl className="space-y-1 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted">{t(k as "about.phone")}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {write && (
            <a
              href={write}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary mt-3 inline-flex"
            >
              {t("product.writeShop")}
            </a>
          )}
        </section>
      )}
      {a.delivery && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">{t("about.delivery")}</h2>
          <p className="text-sm whitespace-pre-line">{a.delivery}</p>
        </section>
      )}
      {a.payment && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">{t("about.payment")}</h2>
          <p className="text-sm whitespace-pre-line">{a.payment}</p>
        </section>
      )}
      {reviews.length > 0 && (
        <section id="reviews" className="mt-8" data-testid="about-reviews">
          <h2 className="mb-3 text-sm font-semibold">{t("showcase.reviews")}</h2>
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="card p-3 text-sm">
                <div aria-label={`${r.rating}/5`}>{"★".repeat(r.rating)}</div>
                <p className="mt-1 whitespace-pre-line">{r.comment}</p>
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
        </section>
      )}
    </article>
  );
}
