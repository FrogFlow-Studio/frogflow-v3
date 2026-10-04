import type React from "react";
import { useEffect } from "react";
import { rememberWebSource } from "@/app/storefront/source";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { storeInfoFn } from "@/app/storefront/storefront.functions";
import { storeShareFn } from "@/app/storefront/share.functions";
import { shopLinks, shopMeta } from "@/core/storefront/share";
import { CartProvider, useCart, useTelegramWebApp } from "@/app/storefront/cart";
import { FavoritesProvider, useFavorites } from "@/app/storefront/favorites";
import { StorefrontLocaleProvider, useStorefrontLocale } from "@/app/storefront/locale";
import { storefrontT } from "@/app/i18n/storefront";
import { ThemeToggle } from "@/app/ui";
import { activeTab, miniAppTabs, type MiniAppTab } from "@/core/storefront/tabs";
import { showMobileCartBar } from "@/core/storefront/mobile";
import { formatMoney } from "@/core/money/money";

export const Route = createFileRoute("/s/$slug")({
  loader: async ({ params }) => {
    const [info, share] = await Promise.all([
      storeInfoFn({ data: { slug: params.slug } }),
      storeShareFn({ data: { slug: params.slug } }),
    ]);
    return { ...info, share };
  },
  head: ({ loaderData }) => {
    const fallback = storefrontT(loaderData?.locale ?? "ru")("meta.shop");
    return {
      meta: loaderData
        ? shopMeta({
            slug: loaderData.slug,
            name: loaderData.name,
            tagline: loaderData.tagline,
            accent: loaderData.accent,
            origin: loaderData.share.origin,
            cover: loaderData.share.cover,
          })
        : [{ title: fallback }],
      links: loaderData?.share.installable ? shopLinks(loaderData.slug) : [],
      scripts: [{ src: "https://telegram.org/js/telegram-web-app.js" }],
    };
  },
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
  // Откуда пришёл покупатель (utm, ref) — запоминается при первом входе.
  useEffect(() => rememberWebSource(shop.slug, window.location.search), [shop.slug]);
  return (
    <StorefrontLocaleProvider slug={shop.slug} initial={shop.locale}>
      <CartProvider slug={shop.slug}>
        <FavoritesProvider slug={shop.slug}>
          <StoreFrame />
        </FavoritesProvider>
      </CartProvider>
    </StorefrontLocaleProvider>
  );
}

function StoreFrame() {
  const shop = Route.useLoaderData();
  const { t } = useStorefrontLocale();
  const themeLabels = { light: t("theme.light"), dark: t("theme.dark") };
  const wa = useTelegramWebApp();
  return (
    <div
      className="flex min-h-screen flex-col"
      style={shop.accent ? ({ "--accent": shop.accent } as React.CSSProperties) : undefined}
    >
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
                <span className="hidden truncate text-xs text-muted sm:block">{shop.tagline}</span>
              )}
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden sm:inline-flex">
              <ThemeToggle labels={themeLabels} />
            </span>
            {shop.botUsername && (
              <a
                href={`https://t.me/${shop.botUsername}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary hidden sm:inline-flex"
              >
                {t("layout.openTelegram")}
              </a>
            )}
            {shop.giftSale && !wa && (
              <Link
                to="/s/$slug/gift"
                params={{ slug: shop.slug }}
                className="btn-secondary"
                aria-label={t("gift.title")}
              >
                🎁<span className="hidden sm:inline">{t("gift.nav")}</span>
              </Link>
            )}
            {!wa && <FavoritesLink slug={shop.slug} />}
            {/* В Mini App корзина и заказы — в нижних вкладках. */}
            {!wa && <CartButton slug={shop.slug} />}
          </div>
        </div>
      </header>
      {shop.paused && (
        <div className="bg-warn/20 px-4 py-2 text-center text-sm">{t("layout.paused")}</div>
      )}
      <main
        className={`mx-auto w-full max-w-6xl flex-1 px-4 py-6${wa ? " pb-24" : " max-sm:pb-20"}`}
      >
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 text-xs text-muted">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {shop.legal.offer && (
              <Link to="/s/$slug/legal/$doc" params={{ slug: shop.slug, doc: "offer" }}>
                {t("footer.offer")}
              </Link>
            )}
            {shop.legal.privacy && (
              <Link to="/s/$slug/legal/$doc" params={{ slug: shop.slug, doc: "privacy" }}>
                {t("footer.privacy")}
              </Link>
            )}
            {shop.legal.requisites && (
              <Link to="/s/$slug/legal/$doc" params={{ slug: shop.slug, doc: "requisites" }}>
                {t("footer.requisites")}
              </Link>
            )}
            {shop.legal.about && (
              <Link to="/s/$slug/legal/$doc" params={{ slug: shop.slug, doc: "about" }}>
                {t("footer.about")}
              </Link>
            )}
            {shop.contactLink && (
              <a href={shop.contactLink} target="_blank" rel="noreferrer">
                {t("footer.contact")}
              </a>
            )}
            {shop.botUsername && (
              <a href={`https://t.me/${shop.botUsername}`} target="_blank" rel="noreferrer">
                {t("footer.bot")}
              </a>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="sm:hidden">
              <ThemeToggle labels={themeLabels} />
            </span>
            <Link to="/" className="hover:text-fg">
              {t("footer.poweredBy")}
            </Link>
          </div>
        </div>
      </footer>
      {wa && <TabBar slug={shop.slug} vertical={shop.vertical} />}
      {!wa && <MobileCartBar slug={shop.slug} />}
    </div>
  );
}

const TAB_ICON: Record<MiniAppTab, string> = {
  catalog: "🏠",
  library: "📚",
  orders: "🧾",
  cart: "🛒",
};

/** Нижние вкладки Mini App (только внутри Telegram), как в v1. */
function TabBar({ slug, vertical }: { slug: string; vertical: string }) {
  const { t } = useStorefrontLocale();
  const cart = useCart();
  const location = useRouterState({ select: (s) => s.location });
  const tab = (location.search as { tab?: unknown }).tab;
  const active = activeTab(location.pathname, slug, typeof tab === "string" ? tab : undefined);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-md">
        {miniAppTabs(vertical).map((key) => {
          const cls = `relative flex flex-col items-center gap-0.5 py-2 text-xs ${
            active === key ? "text-accent" : "text-muted"
          }`;
          const label = (
            <>
              <span className="text-lg leading-none" aria-hidden>
                {TAB_ICON[key]}
              </span>
              {t(`tabs.${key}`)}
              {key === "cart" && cart.count > 0 && (
                <span className="absolute top-1 right-1/4 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg">
                  {cart.count}
                </span>
              )}
            </>
          );
          return (
            <li key={key} className="flex-1">
              {key === "catalog" ? (
                <Link to="/s/$slug" params={{ slug }} className={cls}>
                  {label}
                </Link>
              ) : key === "cart" ? (
                <Link to="/s/$slug/cart" params={{ slug }} className={cls}>
                  {label}
                </Link>
              ) : (
                <Link to="/s/$slug/orders" params={{ slug }} search={{ tab: key }} className={cls}>
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Липкая корзина на телефоне: видна, пока в корзине что-то есть и это не сама корзина. */
function MobileCartBar({ slug }: { slug: string }) {
  const cart = useCart();
  const { t } = useStorefrontLocale();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!showMobileCartBar(pathname, slug, cart.count)) return null;
  return (
    <Link
      to="/s/$slug/cart"
      params={{ slug }}
      data-testid="mobile-cart-bar"
      className="btn-primary fixed inset-x-3 bottom-3 z-20 flex justify-between pb-[env(safe-area-inset-bottom)] shadow-lg sm:hidden"
    >
      <span>
        🛒 {t("layout.cart")} · {cart.count}
      </span>
      <span>{formatMoney(cart.total, cart.currency)}</span>
    </Link>
  );
}

function FavoritesLink({ slug }: { slug: string }) {
  const fav = useFavorites();
  const { t } = useStorefrontLocale();
  return (
    <Link
      to="/s/$slug/favorites"
      params={{ slug }}
      className="btn-secondary relative"
      aria-label={t("layout.favorites")}
    >
      ♡<span className="hidden sm:inline">{t("layout.favorites")}</span>
      {fav.ids.length > 0 && (
        <span className="absolute -top-2 -right-2 rounded-full border-2 border-surface bg-fg px-1.5 text-xs font-semibold text-bg">
          {fav.ids.length}
        </span>
      )}
    </Link>
  );
}

function CartButton({ slug }: { slug: string }) {
  const cart = useCart();
  const { t } = useStorefrontLocale();
  return (
    <Link to="/s/$slug/cart" params={{ slug }} className="btn-primary relative">
      🛒 <span className="hidden sm:inline">{t("layout.cart")}</span>
      {cart.count > 0 && (
        <span className="absolute -top-2 -right-2 rounded-full border-2 border-surface bg-fg px-1.5 text-xs font-semibold text-bg">
          {cart.count}
        </span>
      )}
    </Link>
  );
}
