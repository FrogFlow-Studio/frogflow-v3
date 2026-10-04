import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  CatalogView,
  catalogDeps,
  catalogHead,
  catalogSearch,
  loadCatalog,
} from "@/app/storefront/catalog-view";

export const Route = createFileRoute("/s/$slug/")({
  validateSearch: catalogSearch,
  // Старый адрес `?category=` — на страницу категории `/c/<id>` (основной адрес, он же в карте сайта).
  beforeLoad: ({ params, search }) => {
    if (search.category) {
      const { category, ...rest } = search;
      throw redirect({
        to: "/s/$slug/c/$category",
        params: { slug: params.slug, category },
        search: rest,
        statusCode: 301,
      });
    }
  },
  loaderDeps: ({ search }) => catalogDeps(search),
  loader: ({ params, deps }) => loadCatalog(params.slug, deps),
  head: ({ match, matches, loaderData }) =>
    catalogHead(matches, match.search, loaderData?.items.length ?? null),
  component: CatalogPage,
});

function CatalogPage() {
  return (
    <CatalogView
      first={Route.useLoaderData()}
      slug={Route.useParams().slug}
      s={Route.useSearch()}
    />
  );
}
