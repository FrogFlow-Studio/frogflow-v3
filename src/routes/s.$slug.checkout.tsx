import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { readWebSource } from "@/app/storefront/source";
import { useState, type FormEvent } from "react";
import { webCheckoutFn, webCheckoutInfoFn } from "@/app/storefront/checkout.functions";
import { CHALLENGE_MIN_FILL_MS, solveChallenge } from "@/app/signup/challenge-solve";
import { useCart } from "@/app/storefront/cart";
import { rememberOrderToken } from "@/app/storefront/order-token";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { TgLoginBox, useTgLogin } from "@/app/storefront/tg-login";
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
  // Вошёл через Telegram — заказ попадёт к тому же покупателю, что и в боте.
  const login = useTgLogin(slug);
  const navigate = useNavigate();
  // Решение задачи одноразовое: после отказа (неверный промокод, товар
  // закончился) берём новую, чтобы покупатель исправил поле и отправил снова.
  const [challenge, setChallenge] = useState(info.enabled ? info.challenge : "");
  const physical = cart.lines.some((l) => l.kind === "physical");
  const ff = info.enabled ? info.fulfillment : null;
  const [ftype, setFtype] = useState<"pickup" | "delivery">(
    ff && !ff.pickup && ff.delivery ? "delivery" : "pickup",
  );
  const { run, busy, error } = useAction(async (f: FormData) => {
    if (!info.enabled) return;
    // Задача против ботов решается в браузере, пока кнопка «занята».
    const answer = await solveChallenge(challenge);
    // Сервер не принимает форму быстрее трёх секунд после выдачи задачи
    // (автозаполнение успевает) — дожидаемся молча, а не просим обновить.
    const issued = Number(challenge.split(".")[1]);
    const wait = issued + CHALLENGE_MIN_FILL_MS + 250 - Date.now();
    if (wait > 0)
      await new Promise((r) => setTimeout(r, Math.min(wait, CHALLENGE_MIN_FILL_MS + 250)));
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
        fulfillment: physical
          ? {
              type: ftype,
              date: String(f.get("date") ?? ""),
              slot: String(f.get("slot") ?? "") || null,
              zoneId: ftype === "delivery" ? String(f.get("zone") ?? "") || null : null,
              address: ftype === "delivery" ? String(f.get("address") ?? "") : null,
              note: String(f.get("note") ?? "") || null,
            }
          : null,
        promo: String(f.get("promo") ?? "") || undefined,
        gift: String(f.get("gift") ?? "") || undefined,
        website: String(f.get("website") ?? ""),
        source: readWebSource(slug),
        challenge,
        answer,
      },
    }).catch(async (e: unknown) => {
      const fresh = await webCheckoutInfoFn({ data: { slug } }).catch(() => null);
      if (fresh?.enabled) setChallenge(fresh.challenge);
      throw e;
    });
    cart.clear();
    rememberOrderToken(slug, String(r.id), r.t);
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
      <div className="mb-4">
        <TgLoginBox login={login} />
      </div>
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
        {physical && ff && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{t("checkout.fulfillment.title")}</legend>
            {ff.pickup && ff.delivery && (
              <div className="flex gap-4 text-sm">
                {(["pickup", "delivery"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="ftype"
                      checked={ftype === k}
                      onChange={() => setFtype(k)}
                    />
                    {t(`checkout.fulfillment.${k}`)}
                  </label>
                ))}
              </div>
            )}
            <Field label={t("checkout.fulfillment.date")} hint={t("checkout.fulfillment.dateHint")}>
              <input className="input" name="date" type="date" required min={ff.today} />
            </Field>
            {ff.slots.length > 0 && (
              <Field label={t("checkout.fulfillment.slot")}>
                <select className="input" name="slot" required defaultValue="">
                  <option value="" disabled />
                  {ff.slots.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {ftype === "delivery" && ff.zones.length > 0 && (
              <Field label={t("checkout.fulfillment.zone")}>
                <select className="input" name="zone" required defaultValue="">
                  <option value="" disabled />
                  {ff.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} (+{formatMoney(z.fee.amount, z.fee.currency)})
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {ftype === "delivery" && (
              <Field label={t("checkout.fulfillment.address")}>
                <textarea
                  className="input"
                  name="address"
                  required
                  maxLength={500}
                  rows={2}
                  autoComplete="street-address"
                />
              </Field>
            )}
            <Field label={t("checkout.fulfillment.note")}>
              <textarea className="input" name="note" maxLength={500} rows={2} />
            </Field>
          </fieldset>
        )}
        {info.codes.promo && (
          <Field label={t("checkout.promo")}>
            <input className="input" name="promo" maxLength={40} autoComplete="off" />
          </Field>
        )}
        {info.codes.gift && (
          <Field label={t("checkout.gift")}>
            <input className="input" name="gift" maxLength={40} autoComplete="off" />
          </Field>
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
    </div>
  );
}
