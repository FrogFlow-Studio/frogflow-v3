import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  createHandoffFn,
  miniAppCheckoutFn,
  storeUpsellFn,
  storeUpsellAddedFn,
} from "@/app/storefront/storefront.functions";
import { webCheckoutInfoFn } from "@/app/storefront/checkout.functions";
import { useCart, useTelegramWebApp } from "@/app/storefront/cart";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { formatMoney } from "@/core/money/money";
import { Empty, ErrorBox, useAction } from "@/app/ui";

export const Route = createFileRoute("/s/$slug/cart")({
  loader: async ({ params }) => ({
    web: (await webCheckoutInfoFn({ data: { slug: params.slug } })).enabled,
  }),
  component: CartPage,
});

function CartPage() {
  const { slug } = Route.useParams();
  const { t } = useStorefrontLocale();
  const cart = useCart();
  const wa = useTelegramWebApp();
  const { web } = Route.useLoaderData();
  // Оформление на сайте — вне Mini App: из Telegram заказ уходит в бота.
  const webCheckout = web && !wa;
  const [done, setDone] = useState<string | null>(null);
  const upsell = useUpsell(
    slug,
    cart.lines.map((l) => l.productId),
  );
  const checkout = useAction(async () => {
    const items = cart.lines.map((l) => ({
      product_id: l.productId,
      product_variant_id: l.variantId,
      quantity: l.qty,
    }));
    if (wa) {
      await miniAppCheckoutFn({ data: { slug, initData: wa.initData, items } });
      cart.clear();
      setDone(t("cart.sentToBot"));
      setTimeout(() => wa.close(), 1200);
      return;
    }
    const { url } = await createHandoffFn({ data: { slug, items } });
    cart.clear();
    setDone(t("cart.openingTelegram"));
    window.location.href = url;
  });
  if (cart.lines.length === 0 && !done) {
    return (
      <Empty>
        {t("cart.empty")}{" "}
        <Link to="/s/$slug" params={{ slug }} className="text-accent hover:underline">
          {t("cart.toCatalog")}
        </Link>
      </Empty>
    );
  }
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-xl font-semibold">{t("cart.title")}</h1>
      {done && <p className="mb-4 rounded-md bg-ok/10 px-3 py-2 text-sm text-ok">{done}</p>}
      <ul className="divide-y divide-line">
        {cart.lines.map((l) => (
          <li key={`${l.productId}:${l.variantId}`} className="flex items-center gap-3 py-3">
            {l.image ? (
              <img src={l.image} alt="" className="h-14 w-14 rounded object-cover" />
            ) : (
              <div className="h-14 w-14 rounded bg-surface-2" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{l.name}</div>
              <div className="text-xs text-muted">{formatMoney(l.price, l.currency)}</div>
            </div>
            {l.kind === "physical" ? (
              <div className="flex items-center gap-1">
                <button
                  className="btn-ghost px-2"
                  onClick={() => cart.setQty(l.productId, l.variantId, l.qty - 1)}
                >
                  −
                </button>
                <span className="w-6 text-center text-sm tabular-nums">{l.qty}</span>
                <button
                  className="btn-ghost px-2"
                  onClick={() => cart.setQty(l.productId, l.variantId, l.qty + 1)}
                >
                  +
                </button>
              </div>
            ) : (
              <button
                className="btn-ghost px-2 text-xs"
                onClick={() => cart.setQty(l.productId, l.variantId, 0)}
              >
                {t("cart.remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {cart.lines.length > 0 && (
        <>
          <div className="mt-4 flex items-center justify-between text-lg font-semibold">
            <span>{t("cart.total")}</span>
            <span className="tabular-nums">{formatMoney(cart.total, cart.currency)}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {wa ? t("cart.nextStep") : t("cart.nextStepTelegram")}
          </p>
          {webCheckout && (
            <Link
              to="/s/$slug/checkout"
              params={{ slug }}
              className="btn-primary mt-4 block w-full text-center"
            >
              {t("cart.checkoutWeb")}
            </Link>
          )}
          <button
            className={`${webCheckout ? "btn-ghost" : "btn-primary"} mt-4 w-full`}
            disabled={checkout.busy}
            onClick={() => void checkout.run().catch(() => {})}
          >
            {wa ? t("cart.checkout") : t("cart.checkoutTelegram")}
          </button>
          <ErrorBox error={checkout.error} />
          {upsell.length > 0 && <UpsellBlock slug={slug} offers={upsell} />}
        </>
      )}
    </div>
  );
}

type Offer = Awaited<ReturnType<typeof storeUpsellFn>>[number];

/**
 * «С этим берут» — те же правила, что в боте. Корзина в браузере, поэтому
 * предложения запрашиваем при каждом её изменении; сбой — просто без блока.
 */
function useUpsell(slug: string, ids: string[]): Offer[] {
  const [offers, setOffers] = useState<Offer[]>([]);
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    if (!key) {
      setOffers([]);
      return;
    }
    let live = true;
    storeUpsellFn({ data: { slug, ids: key.split(",") } })
      .then((r) => live && setOffers(r))
      .catch(() => live && setOffers([]));
    return () => {
      live = false;
    };
  }, [slug, key]);
  return offers;
}

function UpsellBlock({ slug, offers }: { slug: string; offers: Offer[] }) {
  const { t } = useStorefrontLocale();
  const cart = useCart();
  const [mixed, setMixed] = useState(false);
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-base font-semibold">{t("cart.upsell")}</h2>
      <ul className="divide-y divide-line">
        {offers.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-3">
            {p.images[0] ? (
              <img src={p.images[0]} alt="" className="h-12 w-12 rounded object-cover" />
            ) : (
              <div className="h-12 w-12 rounded bg-surface-2" />
            )}
            <Link
              to="/s/$slug/p/$id"
              params={{ slug, id: p.id }}
              className="min-w-0 flex-1 hover:underline"
            >
              <div className="truncate text-sm font-medium">{p.name}</div>
              <div className="text-xs text-muted">
                {p.priceFrom
                  ? t("catalog.priceFrom", { price: formatMoney(p.price, p.currency) })
                  : formatMoney(p.price, p.currency)}
              </div>
            </Link>
            {p.variants.length > 0 ? (
              <Link
                to="/s/$slug/p/$id"
                params={{ slug, id: p.id }}
                className="btn-secondary px-2.5 py-1 text-xs"
              >
                {t("catalog.choose")}
              </Link>
            ) : (
              <button
                className="btn-secondary px-2.5 py-1 text-xs"
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
                  setMixed(r === "mixed");
                  // Отметка для итогов допродажи; сбой счётчика покупателю не показываем.
                  if (r !== "mixed")
                    void storeUpsellAddedFn({ data: { slug, productId: p.id } }).catch(() => {});
                }}
              >
                {t("catalog.addToCart")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {mixed && <p className="mt-2 text-xs text-muted">{t("catalog.mixed")}</p>}
    </section>
  );
}
