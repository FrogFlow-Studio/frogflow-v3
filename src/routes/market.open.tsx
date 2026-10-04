import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { marketHeadLinks } from "@/app/market/seo";
import { openT, type OpenKey } from "@/app/market/open-i18n";
import { openChallengeFn, submitOpenRequestFn } from "@/app/market/open.functions";
import { solveChallenge } from "@/app/signup/challenge-solve";
import { signupVerticalTitle } from "@/app/signup/i18n";
import { formatTenge } from "@/app/landing/config";
import { ErrorBox, Field, useAction } from "@/app/ui";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { OPEN_VERTICALS, isOpenVertical, isTier } from "@/core/marketplace/open-request";
import { CONNECTION_PRICE, MONTHLY_PRICE, PLAN_TIERS } from "@/core/plans/registry";
import { VERTICALS } from "@/core/verticals/registry";

/**
 * «Открыть свой магазин» на площадке (В19): ниша, тариф, контакт. Заявка попадает к
 * оператору лидом; магазин он создаёт одной кнопкой. Деньги не списываются.
 */
export const Route = createFileRoute("/market/open")({
  validateSearch: z.object({
    lang: z.enum(SUPPORTED_LOCALES).optional().catch(undefined),
    vertical: z
      .string()
      .optional()
      .catch(undefined)
      .transform((v) => (isOpenVertical(v) ? v : undefined)),
    tier: z
      .string()
      .optional()
      .catch(undefined)
      .transform((v) => (isTier(v) ? v : undefined)),
  }),
  loader: () => openChallengeFn(),
  head: ({ match }) => {
    const t = openT(match.search.lang ?? "ru");
    return {
      meta: [{ title: t("meta.title") }, { name: "description", content: t("meta.description") }],
      links: marketHeadLinks("/market/open", match.search.lang ?? "ru"),
    };
  },
  component: OpenShopPage,
});

function OpenShopPage() {
  const { challenge } = Route.useLoaderData();
  const search = Route.useSearch();
  const locale: Locale = search.lang ?? "ru";
  const t = openT(locale);
  const [done, setDone] = useState(false);
  const [refusal, setRefusal] = useState<OpenKey | null>(null);
  const { run, busy, error } = useAction(async (f: FormData) => {
    setRefusal(null);
    // Задача против ботов решается в браузере за секунду-две, пока кнопка «занята».
    const answer = await solveChallenge(challenge);
    const r = await submitOpenRequestFn({
      data: {
        vertical: String(f.get("vertical") ?? ""),
        tier: String(f.get("tier") ?? ""),
        locale,
        businessName: String(f.get("businessName") ?? ""),
        phone: String(f.get("phone") ?? ""),
        email: String(f.get("email") ?? ""),
        instagramHandle: String(f.get("instagramHandle") ?? ""),
        city: String(f.get("city") ?? ""),
        comment: String(f.get("comment") ?? ""),
        website: String(f.get("website") ?? ""),
        challenge,
        answer,
      },
    });
    if (r.ok) setDone(true);
    else setRefusal(`err.${r.error}` as OpenKey);
  });
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          search={search.lang ? { lang: search.lang } : {}}
          className="text-lg font-semibold"
        >
          🐸 FrogFlow
        </Link>
        <nav className="flex gap-2 text-sm">
          {SUPPORTED_LOCALES.map((l) => (
            <Link
              key={l}
              to="/market/open"
              search={{ ...search, lang: l }}
              className={l === locale ? "font-medium" : "text-muted"}
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
      <h1 className="mt-6 text-2xl font-semibold">{t("title")}</h1>
      {done ? (
        <div className="card mt-6 p-5" role="status">
          <h2 className="font-medium">{t("done.title")}</h2>
          <p className="mt-2 text-sm text-muted">{t("done.text")}</p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">{t("lead")}</p>
          <form
            className="card mt-6 space-y-5 p-5"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              void run(new FormData(e.currentTarget)).catch(() => {});
            }}
          >
            <fieldset className="space-y-2">
              <legend className="font-medium">{t("step.niche")}</legend>
              {OPEN_VERTICALS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="vertical"
                    value={k}
                    defaultChecked={search.vertical === k}
                    required
                  />
                  {signupVerticalTitle(locale, k, VERTICALS[k].title)}
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-medium">{t("step.tier")}</legend>
              {PLAN_TIERS.map((k) => (
                <label key={k} className="flex flex-col text-sm">
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="tier"
                      value={k}
                      defaultChecked={(search.tier ?? "pro") === k}
                      required
                    />
                    {t(`tier.${k}` as OpenKey)}
                  </span>
                  <span className="ml-6 text-xs text-muted">
                    {t("tier.price", {
                      setup: formatTenge(CONNECTION_PRICE[k]),
                      monthly: formatTenge(MONTHLY_PRICE[k]),
                    })}
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="font-medium">{t("step.contact")}</legend>
              <Field label={t("field.name")}>
                <input className="input" name="businessName" required maxLength={120} />
              </Field>
              <Field label={t("field.phone")}>
                <input
                  className="input"
                  name="phone"
                  type="tel"
                  maxLength={60}
                  autoComplete="tel"
                />
              </Field>
              <Field label={t("field.email")}>
                <input
                  className="input"
                  name="email"
                  type="email"
                  maxLength={200}
                  autoComplete="email"
                />
              </Field>
              <Field label={t("field.instagram")}>
                <input
                  className="input"
                  name="instagramHandle"
                  maxLength={300}
                  placeholder="@shop"
                />
              </Field>
              <p className="text-xs text-muted">{t("contact.hint")}</p>
              <Field label={t("field.city")}>
                <input className="input" name="city" maxLength={200} />
              </Field>
              <Field label={t("field.comment")}>
                <textarea className="input" name="comment" rows={3} maxLength={1000} />
              </Field>
            </fieldset>
            <input name="website" className="hidden" tabIndex={-1} autoComplete="off" />
            {refusal && (
              <p className="text-sm text-danger" role="alert">
                {t(refusal)}
              </p>
            )}
            <ErrorBox error={error ? new Error(t("err.failed")) : null} />
            <button className="btn-primary w-full" disabled={busy}>
              {t("submit")}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
