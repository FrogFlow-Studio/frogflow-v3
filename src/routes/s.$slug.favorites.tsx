import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { storeFavoritesFn } from "@/app/storefront/catalog.functions";
import { createHandoffFn, miniAppCheckoutFn } from "@/app/storefront/storefront.functions";
import { useTelegramWebApp } from "@/app/storefront/cart";
import { FavoriteButton, useFavorites } from "@/app/storefront/favorites";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { OfferPrice } from "@/app/storefront/offer";
import { formatRatingSummary } from "@/core/reviews/pure";
import type { StoreProduct } from "@/core/storefront/catalog";
import { Empty, ErrorBox, useAction } from "@/app/ui";

export const Route = createFileRoute("/s/$slug/favorites")({
  component: FavoritesPage,
});

/**
 * «Избранное»: список лежит в браузере (localStorage), сервер лишь отдаёт
 * карточки по id. Исчезнувшие товары тихо убираются из браузера; при сбое
 * чтения ничего не удаляем.
 */
function FavoritesPage() {
  const { slug } = Route.useParams();
  const { t } = useStorefrontLocale();
  const fav = useFavorites();
  const [items, setItems] = useState<StoreProduct[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const wa = useTelegramWebApp();
  const [done, setDone] = useState("");
  // Товар с вариантами в корзину «без варианта» не ложится, а закончившийся не купить: в бот идут остальные.
  const sendable =
    items?.filter((p) => fav.has(p.id) && (p.inStock || p.preorder) && p.variants.length === 0) ??
    [];
  const skipped = (items?.filter((p) => fav.has(p.id)).length ?? 0) - sendable.length;
  const toTelegram = useAction(async () => {
    const lines = sendable.map((p) => ({
      product_id: p.id,
      product_variant_id: null,
      quantity: 1,
    }));
    if (wa) {
      await miniAppCheckoutFn({ data: { slug, initData: wa.initData, items: lines } });
      setDone(t("cart.sentToBot"));
      setTimeout(() => wa.close(), 1200);
      return;
    }
    const { url } = await createHandoffFn({ data: { slug, items: lines } });
    setDone(t("cart.openingTelegram"));
    window.location.href = url;
  });
  useEffect(() => {
    if (!fav.ready) return;
    if (items !== null) return;
    if (fav.ids.length === 0) return void setItems([]);
    let live = true;
    storeFavoritesFn({ data: { slug, ids: fav.ids } }).then(
      (r) => {
        if (!live) return;
        setItems(r);
        fav.keepOnly(r.map((p) => p.id));
      },
      (e) => live && setFailed(e ?? new Error("favorites")),
    );
    return () => {
      live = false;
    };
    // Список читаем один раз: снятое сердечко прячет карточку сразу, без повторного запроса.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fav.ready, slug]);
  if (failed) return <ErrorBox error={failed} />;
  if (!fav.ready || items === null) return null;
  const shown = items.filter((p) => fav.has(p.id));
  if (shown.length === 0) {
    return (
      <Empty>
        {t("fav.empty")}{" "}
        <Link to="/s/$slug" params={{ slug }} className="text-accent hover:underline">
          {t("cart.toCatalog")}
        </Link>
      </Empty>
    );
  }
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t("fav.title")}</h1>
      {sendable.length > 0 && (
        <div className="mb-4">
          <button
            className="btn-primary"
            disabled={toTelegram.busy}
            onClick={() => void toTelegram.run().catch(() => {})}
          >
            {t("fav.toTelegram")}
          </button>
          {skipped > 0 && (
            <p className="mt-2 text-xs text-muted">{t("fav.variantsSkipped", { n: skipped })}</p>
          )}
          {done && <p className="mt-2 rounded-md bg-ok/10 px-3 py-2 text-sm text-ok">{done}</p>}
          <ErrorBox error={toTelegram.error} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((p) => (
          <article key={p.id} className="card relative flex flex-col overflow-hidden">
            <Link to="/s/$slug/p/$id" params={{ slug, id: p.id }} className="block">
              {p.images[0] ? (
                <img src={p.images[0]} alt={p.name} className="aspect-square w-full object-cover" />
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
              {p.rating && (
                <span className="text-xs text-muted">
                  {formatRatingSummary(p.rating.avg, p.rating.count)}
                </span>
              )}
              <span className="text-sm font-semibold">
                <OfferPrice
                  price={p.price}
                  oldPrice={p.offer?.oldPrice ?? null}
                  currency={p.currency}
                  offer={p.offer}
                  label={(price) => (p.priceFrom ? t("catalog.priceFrom", { price }) : price)}
                />
              </span>
              {!p.inStock && (
                <span className="text-xs text-muted">
                  {p.preorder ? t("catalog.preorder") : t("catalog.outOfStock")}
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
