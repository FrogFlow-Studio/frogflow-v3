import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { storeInfoFn } from "@/app/storefront/storefront.functions";
import { CartProvider, useCart } from "@/app/storefront/cart";

export const Route = createFileRoute("/s/$slug")({
  loader: ({ params }) => storeInfoFn({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.name ?? "Магазин" },
      { property: "og:title", content: loaderData?.name ?? "Магазин" },
    ],
    scripts: [{ src: "https://telegram.org/js/telegram-web-app.js" }],
  }),
  component: StoreLayout,
  notFoundComponent: () => (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-lg font-semibold">Магазин не найден</h1>
    </main>
  ),
});

function StoreLayout() {
  const shop = Route.useLoaderData();
  return (
    <CartProvider slug={shop.slug}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
            <Link
              to="/s/$slug"
              params={{ slug: shop.slug }}
              className="truncate text-base font-semibold"
            >
              {shop.name}
            </Link>
            <CartButton slug={shop.slug} />
          </div>
        </header>
        {shop.paused && (
          <div className="bg-warn/20 px-4 py-2 text-center text-sm">
            Магазин временно не принимает заказы.
          </div>
        )}
        <main className="mx-auto max-w-5xl px-4 py-5">
          <Outlet />
        </main>
        <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-muted">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {shop.legal.offer && (
              <Link to="/s/$slug/legal/$doc" params={{ slug: shop.slug, doc: "offer" }}>
                Оферта
              </Link>
            )}
            {shop.legal.privacy && (
              <Link to="/s/$slug/legal/$doc" params={{ slug: shop.slug, doc: "privacy" }}>
                Конфиденциальность
              </Link>
            )}
            {shop.legal.requisites && (
              <Link to="/s/$slug/legal/$doc" params={{ slug: shop.slug, doc: "requisites" }}>
                Реквизиты
              </Link>
            )}
            {shop.legal.about && (
              <Link to="/s/$slug/legal/$doc" params={{ slug: shop.slug, doc: "about" }}>
                О продавце
              </Link>
            )}
            {shop.contactLink && (
              <a href={shop.contactLink} target="_blank" rel="noreferrer">
                Связаться с продавцом
              </a>
            )}
          </div>
          <div className="mt-3">Работает на FrogFlow</div>
        </footer>
      </div>
    </CartProvider>
  );
}

function CartButton({ slug }: { slug: string }) {
  const cart = useCart();
  return (
    <Link to="/s/$slug/cart" params={{ slug }} className="btn-secondary relative">
      🛒 Корзина
      {cart.count > 0 && (
        <span className="absolute -top-2 -right-2 rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg">
          {cart.count}
        </span>
      )}
    </Link>
  );
}
