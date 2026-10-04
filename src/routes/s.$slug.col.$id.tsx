import { createFileRoute, Link } from "@tanstack/react-router";
import { storeCollectionFn } from "@/app/storefront/catalog.functions";
import { FavoriteButton } from "@/app/storefront/favorites";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { OfferPrice } from "@/app/storefront/offer";
import { Empty } from "@/app/ui";
import { canonicalLink, shopCanonical } from "@/core/storefront/seo";

export const Route = createFileRoute("/s/$slug/col/$id")({
  loader: ({ params }) => storeCollectionFn({ data: { slug: params.slug, id: params.id } }),
  head: ({ loaderData, matches, params }) => {
    const shop = matches.find((m) => (m.routeId as string) === "/s/$slug")?.loaderData as
      { name: string; share: { canonical: string } } | undefined;
    if (!loaderData || !shop) return {};
    const title = `${loaderData.name} — ${shop.name}`;
    const url = `${shopCanonical(shop.share.canonical, params.slug)}/col/${params.id}`;
    return {
      meta: [
        { title },
        { property: "og:title", content: title },
        { property: "og:url", content: url },
        // Пустая подборка поиску не нужна: показывать на ней нечего.
        ...(loaderData.items.length === 0 ? [{ name: "robots", content: "noindex,follow" }] : []),
      ],
      links: [canonicalLink(url)],
    };
  },
  component: CollectionPage,
});

/** Подборка: страница со ссылкой для бота и соцсетей; товары — как на «Избранном». */
function CollectionPage() {
  const page = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { t } = useStorefrontLocale();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{page.name}</h1>
      {page.items.length === 0 ? (
        <Empty>
          {t("collection.empty")}{" "}
          <Link to="/s/$slug" params={{ slug }} className="text-accent hover:underline">
            {t("cart.toCatalog")}
          </Link>
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {page.items.map((p) => (
            <article key={p.id} className="card relative flex flex-col overflow-hidden">
              <Link to="/s/$slug/p/$id" params={{ slug, id: p.id }} className="block">
                {p.images[0] ? (
                  <img
                    src={p.images[0]}
                    alt={p.name}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-surface-2 text-4xl">
                    {p.kind === "digital" ? "📄" : "📦"}
                  </div>
                )}
              </Link>
              <FavoriteButton
                id={p.id}
                addLabel={t("fav.add")}
                removeLabel={t("fav.remove")}
                className="absolute top-2 right-2"
              />
              <div className="flex flex-1 flex-col gap-1 p-3">
                <Link
                  to="/s/$slug/p/$id"
                  params={{ slug, id: p.id }}
                  className="line-clamp-2 text-sm font-medium hover:underline"
                >
                  {p.name}
                </Link>
                <span className="text-sm font-semibold">
                  <OfferPrice
                    price={p.price}
                    oldPrice={p.offer?.oldPrice ?? null}
                    currency={p.currency}
                    offer={p.offer}
                    label={(price) => (p.priceFrom ? t("catalog.priceFrom", { price }) : price)}
                  />
                </span>
                {!p.inStock && p.preorder && (
                  <span className="text-xs text-muted">{t("catalog.preorder")}</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
