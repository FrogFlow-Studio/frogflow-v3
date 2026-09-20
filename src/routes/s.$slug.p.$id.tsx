import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { storeProductFn } from "@/app/storefront/storefront.functions";
import { useCart } from "@/app/storefront/cart";
import { formatMoney } from "@/core/money/money";

export const Route = createFileRoute("/s/$slug/p/$id")({
  loader: ({ params }) => storeProductFn({ data: { slug: params.slug, id: params.id } }),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: loaderData.product.name },
          { property: "og:title", content: loaderData.product.name },
          { property: "og:description", content: loaderData.product.description.slice(0, 200) },
          ...(loaderData.product.images[0]
            ? [{ property: "og:image", content: loaderData.product.images[0] }]
            : []),
        ]
      : [],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { product: p, related } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const cart = useCart();
  const [img, setImg] = useState(0);
  const [variant, setVariant] = useState<string | null>(p.variants[0]?.id ?? null);
  const [msg, setMsg] = useState<string | null>(null);
  const chosen = p.variants.find((v) => v.id === variant) ?? null;
  const price = chosen ? chosen.price : p.price;
  const currency = chosen ? chosen.currency : p.currency;
  const add = () => {
    const r = cart.add({
      productId: p.id,
      variantId: chosen?.id ?? null,
      name: chosen ? `${p.name} (${chosen.name})` : p.name,
      price,
      currency,
      image: p.images[0] ?? null,
      kind: p.kind,
    });
    setMsg(r === "ok" ? "Добавлено в корзину" : "Файлы и физические товары оформляются отдельно.");
    setTimeout(() => setMsg(null), 2000);
  };
  return (
    <>
      <Link to="/s/$slug" params={{ slug }} className="text-sm text-muted hover:underline">
        ← Каталог
      </Link>
      <div className="mt-3 grid gap-6 md:grid-cols-2">
        <div>
          {p.images[img] ? (
            <img
              src={p.images[img]}
              alt={p.name}
              className="aspect-square w-full rounded-lg object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-lg bg-surface-2 text-5xl">
              📦
            </div>
          )}
          {p.images.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {p.images.map((src, i) => (
                <button
                  key={src}
                  onClick={() => setImg(i)}
                  className={`shrink-0 rounded border-2 ${i === img ? "border-accent" : "border-transparent"}`}
                >
                  <img src={src} alt="" className="h-16 w-16 rounded object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold">{p.name}</h1>
          {p.rating && (
            <div className="mt-1 text-sm text-muted">
              ★ {p.rating.avg.toFixed(1)} · {p.rating.count} отзывов
            </div>
          )}
          <div className="mt-3 text-2xl font-semibold tabular-nums">
            {formatMoney(price, currency)}
          </div>
          {p.leadTimeDays ? (
            <div className="mt-1 text-sm text-muted">
              ⏳ Срок изготовления: {p.leadTimeDays} дн.
            </div>
          ) : null}
          {p.kind === "digital" && p.languages.length > 0 && (
            <div className="mt-1 text-sm text-muted">
              Файлы: {p.languages.map((l) => l.toUpperCase()).join(", ")}
            </div>
          )}
          {p.variants.length > 0 && (
            <div className="mt-4">
              <div className="label">Вариант</div>
              <div className="flex flex-wrap gap-2">
                {p.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVariant(v.id)}
                    className={`badge cursor-pointer px-3 py-1.5 text-sm ${variant === v.id ? "border-accent bg-accent/10 text-accent" : ""}`}
                  >
                    {v.name} · {formatMoney(v.price, v.currency)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-5 flex items-center gap-3">
            {p.inStock ? (
              <button className="btn-primary" onClick={add}>
                🛒 В корзину
              </button>
            ) : (
              <span className="badge">Нет в наличии</span>
            )}
            {msg && <span className="text-sm text-muted">{msg}</span>}
          </div>
          {p.description && (
            <p className="mt-6 text-sm leading-relaxed whitespace-pre-line">{p.description}</p>
          )}
        </div>
      </div>
      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-muted">Похожие товары</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map((r) => (
              <Link
                key={r.id}
                to="/s/$slug/p/$id"
                params={{ slug, id: r.id }}
                className="card overflow-hidden"
              >
                {r.images[0] ? (
                  <img
                    src={r.images[0]}
                    alt=""
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="aspect-square bg-surface-2" />
                )}
                <div className="p-2 text-xs">
                  <div className="line-clamp-2">{r.name}</div>
                  <div className="mt-1 font-semibold">{formatMoney(r.price, r.currency)}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
