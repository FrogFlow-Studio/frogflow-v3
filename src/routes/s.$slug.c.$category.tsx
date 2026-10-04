import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import {
  CatalogView,
  catalogDeps,
  catalogHead,
  catalogSearch,
  loadCatalog,
} from "@/app/storefront/catalog-view";

/** Страница категории: основной адрес категории витрины, фильтры — в строке адреса. */
export const Route = createFileRoute("/s/$slug/c/$category")({
  validateSearch: catalogSearch.omit({ category: true }),
  loaderDeps: ({ search }) => catalogDeps(search),
  loader: ({ params, deps }) => {
    // Адрес с чужим мусором вместо id категории — «не найдено», а не сбой сервера.
    if (!z.string().uuid().safeParse(params.category).success) throw notFound();
    return loadCatalog(params.slug, { ...deps, category: params.category });
  },
  head: ({ match, matches, loaderData }) =>
    catalogHead(
      matches,
      { ...match.search, category: match.params.category },
      loaderData?.items.length ?? null,
    ),
  component: CategoryPage,
});

function CategoryPage() {
  const { slug, category } = Route.useParams();
  return (
    <CatalogView first={Route.useLoaderData()} slug={slug} s={{ ...Route.useSearch(), category }} />
  );
}
