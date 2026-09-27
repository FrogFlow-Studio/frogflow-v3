import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent } from "react";
import { webCheckoutFn, webCheckoutInfoFn } from "@/app/storefront/checkout.functions";
import { solveChallenge } from "@/app/signup/challenge-solve";
import { useCart } from "@/app/storefront/cart";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { formatMoney } from "@/core/money/money";
import { Empty, ErrorBox, Field, useAction } from "@/app/ui";

export const Route = createFileRoute("/s/$slug/checkout")({
  loader: ({ params }) => webCheckoutInfoFn({ data: { slug: params.slug } }),
  component: CheckoutPage,
});

/** Оформление на сайте: контакты и страна оплаты → заказ → страница заказа с оплатой. */
function CheckoutPage() {
  const { slug } = Route.useParams();
  const info = Route.useLoaderData();
  const { t } = useStorefrontLocale();
  const cart = useCart();
  const navigate = useNavigate();
  const physical = cart.lines.some((l) => l.kind === "physical");
  const { run, busy, error } = useAction(async (f: FormData) => {
    if (!info.enabled) return;
    // Задача против ботов решается в браузере, пока кнопка «занята».
    const answer = await solveChallenge(info.challenge);
    const r = await webCheckoutFn({
      data: {
        slug,
        items: cart.lines.map((l) => ({
          product_id: l.productId,
          product_variant_id: l.variantId,
          quantity: l.qty,
        })),
        name: String(f.get("name") ?? ""),
        email: String(f.get("email") ?? ""),
        phone: String(f.get("phone") ?? "") || undefined,
        country: String(f.get("country") ?? ""),
        website: String(f.get("website") ?? ""),
        challenge: info.challenge,
        answer,
      },
    });
    cart.clear();
    await navigate({
      to: "/s/$slug/order/$id",
      params: { slug, id: String(r.id) },
      search: { t: r.t },
    });
  });
  if (!info.enabled || cart.lines.length === 0) {
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
      <h1 className="mb-4 text-xl font-semibold">{t("checkout.title")}</h1>
      <ul className="mb-4 divide-y divide-line text-sm">
        {cart.lines.map((l) => (
          <li key={`${l.productId}:${l.variantId}`} className="flex justify-between gap-3 py-2">
            <span className="truncate">
              {l.name}
              {l.qty > 1 ? ` × ${l.qty}` : ""}
            </span>
            <span className="tabular-nums">{formatMoney(l.price * l.qty, l.currency)}</span>
          </li>
        ))}
      </ul>
      <div className="mb-4 flex items-center justify-between text-lg font-semibold">
        <span>{t("cart.total")}</span>
        <span className="tabular-nums">{formatMoney(cart.total, cart.currency)}</span>
      </div>
      {physical ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">{t("checkout.physicalHint")}</p>
      ) : (
        <form
          className="card space-y-4 p-5"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            void run(new FormData(e.currentTarget)).catch(() => {});
          }}
        >
          <Field label={t("checkout.name")}>
            <input className="input" name="name" required maxLength={64} autoComplete="name" />
          </Field>
          <Field label={t("checkout.email")}>
            <input
              className="input"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
            />
          </Field>
          <Field label={t("checkout.phone")}>
            <input className="input" name="phone" type="tel" maxLength={32} autoComplete="tel" />
          </Field>
          {info.countries.length > 1 ? (
            <Field label={t("checkout.country")}>
              <select className="input" name="country" defaultValue={info.countries[0]?.code}>
                {info.countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <input type="hidden" name="country" value={info.countries[0]?.code ?? ""} />
          )}
          {/* Приманка для ботов: человек это поле не видит и не заполняет. */}
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden="true"
          />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? t("checkout.checking") : t("checkout.submit")}
          </button>
          <ErrorBox error={error} />
        </form>
      )}
    </div>
  );
}
