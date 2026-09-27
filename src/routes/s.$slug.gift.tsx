import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { giftCheckoutFn, giftSaleInfoFn } from "@/app/storefront/gift.functions";
import { CHALLENGE_MIN_FILL_MS, solveChallenge } from "@/app/signup/challenge-solve";
import { rememberOrderToken } from "@/app/storefront/order-token";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { formatMoney } from "@/core/money/money";
import { Empty, ErrorBox, Field, useAction } from "@/app/ui";

export const Route = createFileRoute("/s/$slug/gift")({
  loader: ({ params }) => giftSaleInfoFn({ data: { slug: params.slug } }),
  component: GiftPage,
});

/** Подарочный сертификат: номинал и контакты → заказ → страница заказа с оплатой. */
function GiftPage() {
  const { slug } = Route.useParams();
  const info = Route.useLoaderData();
  const { t } = useStorefrontLocale();
  const navigate = useNavigate();
  const [amount, setAmount] = useState<number | null>(info.open ? (info.amounts[0] ?? null) : null);
  const { run, busy, error } = useAction(async (f: FormData) => {
    if (!info.open || amount == null) return;
    const answer = await solveChallenge(info.challenge);
    const issued = Number(info.challenge.split(".")[1]);
    const wait = issued + CHALLENGE_MIN_FILL_MS + 250 - Date.now();
    if (wait > 0)
      await new Promise((r) => setTimeout(r, Math.min(wait, CHALLENGE_MIN_FILL_MS + 250)));
    const r = await giftCheckoutFn({
      data: {
        slug,
        amount,
        name: String(f.get("name") ?? ""),
        email: String(f.get("email") ?? ""),
        phone: String(f.get("phone") ?? "") || undefined,
        country: String(f.get("country") ?? ""),
        website: String(f.get("website") ?? ""),
        challenge: info.challenge,
        answer,
      },
    });
    rememberOrderToken(slug, String(r.id), r.t);
    await navigate({
      to: "/s/$slug/order/$id",
      params: { slug, id: String(r.id) },
      search: { t: r.t },
    });
  });
  if (!info.open) {
    return (
      <Empty>
        {t("gift.closed")}{" "}
        <Link to="/s/$slug" params={{ slug }} className="text-accent hover:underline">
          {t("cart.toCatalog")}
        </Link>
      </Empty>
    );
  }
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-xl font-semibold">{t("gift.title")}</h1>
      <p className="mb-4 text-sm text-muted">{t("gift.intro")}</p>
      <form
        className="card space-y-4 p-5"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          void run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("gift.amount")}</legend>
          <div className="flex flex-wrap gap-2">
            {info.amounts.map((a) => (
              <label
                key={a}
                className={`cursor-pointer rounded-md border px-3 py-2 text-sm tabular-nums ${
                  amount === a ? "border-accent bg-accent/10 font-semibold" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name="amount"
                  value={a}
                  className="sr-only"
                  checked={amount === a}
                  onChange={() => setAmount(a)}
                />
                {formatMoney(a, info.currency)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t("checkout.name")}>
          <input className="input" name="name" required maxLength={64} autoComplete="name" />
        </Field>
        <Field label={t("gift.email")}>
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
        <button className="btn-primary w-full" disabled={busy || amount == null}>
          {busy ? t("checkout.checking") : t("checkout.submit")}
        </button>
        <ErrorBox error={error} />
      </form>
    </div>
  );
}
