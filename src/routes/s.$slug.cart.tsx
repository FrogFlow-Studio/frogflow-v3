import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { createHandoffFn, miniAppCheckoutFn } from "@/app/storefront/storefront.functions";
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
  // Оформление на сайте — для цифровых товаров; физические пока через бота.
  const webCheckout = web && !wa && !cart.lines.some((l) => l.kind === "physical");
  const [done, setDone] = useState<string | null>(null);
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
        </>
      )}
    </div>
  );
}
