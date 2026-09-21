import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { storeInfoFn } from "@/app/storefront/storefront.functions";
import { CartProvider, useCart } from "@/app/storefront/cart";
import { ThemeToggle } from "@/app/ui";

export const Route = createFileRoute("/s/$slug")({
  loader: ({ params }) => storeInfoFn({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.name ?? "Магазин" },
      { property: "og:title", content: loaderData?.name ?? "Магазин" },
      ...(loaderData?.tagline ? [{ name: "description", content: loaderData.tagline }] : []),
    ],
    scripts: [{ src: "https://telegram.org/js/telegram-web-app.js" }],
  }),
  component: StoreLayout,
  notFoundComponent: () => (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-lg font-semibold">Магазин не найден</h1>
      <p className="mt-2 text-sm text-muted">Проверьте адрес — возможно, ссылка устарела.</p>
    </main>
  ),
});

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "🛍"
  );
}

function StoreLayout() {
  const shop = Route.useLoaderData();
  return (
    <CartProvider slug={shop.slug}>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
            <Link
              to="/s/$slug"
              params={{ slug: shop.slug }}
              className="flex min-w-0 items-center gap-3"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-fg">
                {initials(shop.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold">{shop.name}</span>
                {shop.tagline && (
                  <span className="hidden truncate text-xs text-muted sm:block">
                    {shop.tagline}
                  </span>
                )}
              </span>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden sm:inline-flex">
                <ThemeToggle />
              </span>
              {shop.botUsername && (
                <a
                  href={`https://t.me/${shop.botUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary hidden sm:inline-flex"
                >
                  ✈️ Открыть в Telegram
                </a>
              )}
              <CartButton slug={shop.slug} />
            </div>
          </div>
        </header>
        {shop.paused && (
          <div className="bg-warn/20 px-4 py-2 text-center text-sm">
            Магазин временно не принимает заказы.
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          <Outlet />
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 text-xs text-muted">
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
              {shop.botUsername && (
                <a href={`https://t.me/${shop.botUsername}`} target="_blank" rel="noreferrer">
                  Бот в Telegram
                </a>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="sm:hidden">
                <ThemeToggle />
              </span>
              <Link to="/" className="hover:text-fg">
                Работает на FrogFlow
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </CartProvider>
  );
}

function CartButton({ slug }: { slug: string }) {
  const cart = useCart();
  return (
    <Link to="/s/$slug/cart" params={{ slug }} className="btn-primary relative">
      🛒 <span className="hidden sm:inline">Корзина</span>
      {cart.count > 0 && (
        <span className="absolute -top-2 -right-2 rounded-full border-2 border-surface bg-fg px-1.5 text-xs font-semibold text-bg">
          {cart.count}
        </span>
      )}
    </Link>
  );
}
