import { Link } from "@tanstack/react-router";
import { storefrontCrumbs } from "@/core/storefront/seo";

type T = (key: "catalog.title" | "catalog.breadcrumbs") => string;

/**
 * Хлебные крошки витрины: «Каталог › Категория › Подкатегория › Товар». Звенья —
 * обычные ссылки (работают без JS); последнее — текущая страница, без ссылки.
 * Те же звенья идут в разметку BreadcrumbList (core/storefront/seo).
 */
export function Breadcrumbs({
  slug,
  shop,
  categoryIds,
  leaf,
  t,
}: {
  slug: string;
  shop: {
    name: string;
    categories: Array<{ id: string; name: string; parent_id: string | null }>;
    share: { canonical: string };
  };
  categoryIds: readonly string[];
  /** Название товара; на странице категории не задаётся — последнее звено сама категория. */
  leaf?: string;
  t: T;
}) {
  const crumbs = storefrontCrumbs(
    { name: shop.name, slug, origin: shop.share.canonical },
    shop.categories,
    categoryIds,
    leaf ? { name: leaf, url: "" } : undefined,
  );
  const last = crumbs.length - 1;
  return (
    <nav className="text-sm text-muted" aria-label={t("catalog.breadcrumbs")}>
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {crumbs.map((c, i) => (
          <li key={`${i}:${c.url}`} className="flex items-center gap-x-1.5">
            {i > 0 && <span aria-hidden="true">›</span>}
            {i === last ? (
              <span className="text-fg" aria-current="page">
                {i === 0 ? t("catalog.title") : c.name}
              </span>
            ) : (
              <Link
                to="/s/$slug"
                params={{ slug }}
                search={c.categoryId ? { category: c.categoryId } : {}}
                className="hover:underline"
              >
                {i === 0 ? t("catalog.title") : c.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
