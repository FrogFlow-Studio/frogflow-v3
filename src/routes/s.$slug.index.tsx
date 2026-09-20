import { createFileRoute, Link, useLoaderData, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { storeCatalogFn } from "@/app/storefront/storefront.functions";
import { useCart } from "@/app/storefront/cart";
import { formatMoney } from "@/core/money/money";
import { Empty } from "@/app/ui";

export const Route = createFileRoute("/s/$slug/")({
  validateSearch: z.object({ q: z.string().optional(), category: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    storeCatalogFn({ data: { slug: params.slug, q: deps.q, category: deps.category } }),
  component: CatalogPage,
});

function CatalogPage() {
  const products = Route.useLoaderData();
  const { slug } = Route.useParams();
  const shop = useLoaderData({ from: "/s/$slug" });
  const categories = shop.categories;
  const s = Route.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState(s.q ?? "");
  const cart = useCart();
  const [added, setAdded] = useState<string | null>(null);
  return (
    <>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ to: "/s/$slug", params: { slug }, search: { ...s, q: q || undefined } });
        }}
      >
        <input
          className="input"
          placeholder="Поиск по каталогу"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn-secondary shrink-0">Найти</button>
      </form>
      {categories.length > 0 && (
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          <Link
            to="/s/$slug"
            params={{ slug }}
            search={{ q: s.q }}
            className={`badge shrink-0 ${!s.category ? "border-accent bg-accent/10 text-accent" : ""}`}
          >
            Все
          </Link>
          {categories
            .filter((c) => !c.parent_id)
            .map((c) => (
              <Link
                key={c.id}
                to="/s/$slug"
                params={{ slug }}
                search={{ q: s.q, category: c.id }}
                className={`badge shrink-0 ${s.category === c.id ? "border-accent bg-accent/10 text-accent" : ""}`}
              >
                {c.name}
              </Link>
            ))}
        </div>
      )}
      {products.length === 0 ? (
        <Empty>Ничего не найдено.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <div key={p.id} className="card flex flex-col overflow-hidden">
              <Link to="/s/$slug/p/$id" params={{ slug, id: p.id }} className="block">
                {p.images[0] ? (
                  <img
                    src={p.images[0]}
                    alt={p.name}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-surface-2 text-3xl">
                    📦
                  </div>
                )}
              </Link>
              <div className="flex flex-1 flex-col p-3">
                <Link
                  to="/s/$slug/p/$id"
                  params={{ slug, id: p.id }}
                  className="line-clamp-2 text-sm font-medium hover:underline"
                >
                  {p.name}
                </Link>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {p.priceFrom ? "от " : ""}
                    {formatMoney(p.price, p.currency)}
                  </span>
                  {!p.inStock ? (
                    <span className="text-xs text-muted">нет</span>
                  ) : p.variants.length > 0 ? (
                    <Link
                      to="/s/$slug/p/$id"
                      params={{ slug, id: p.id }}
                      className="btn-secondary px-2 py-1 text-xs"
                    >
                      Выбрать
                    </Link>
                  ) : (
                    <button
                      className="btn-primary px-2 py-1 text-xs"
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
                      {added === p.id ? "✓" : "В корзину"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {added === "mixed" && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-fg px-4 py-2 text-sm text-bg shadow">
          Файлы и физические товары оформляются отдельно.
        </div>
      )}
    </>
  );
}
