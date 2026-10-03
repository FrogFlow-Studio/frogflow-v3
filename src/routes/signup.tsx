import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, type FormEvent } from "react";
import { z } from "zod";
import { readWebSource, rememberWebSource } from "@/app/storefront/source";
import { PLATFORM_SOURCE_SLUG, SIGNUP_PAGES } from "@/core/signup/origin";
import { signupEnabledFn, signupFn } from "@/app/signup/signup.functions";
import { solveChallenge } from "@/app/signup/challenge-solve";
import { VERTICAL_KEYS, VERTICALS, type VerticalKey } from "@/core/verticals/registry";

/** Что продавец может выбрать сам: консультант подключается через оператора. */
const SIGNUP_VERTICALS = VERTICAL_KEYS.filter((k) => !k.startsWith("consultant"));
import { ErrorBox, Field, ThemeToggle, useAction } from "@/app/ui";
import { SUPPORTED_LOCALES, isLocale, type Locale } from "@/core/i18n/locale";
import { signupErrorText, signupT, signupVerticalTitle } from "@/app/signup/i18n";

export const Route = createFileRoute("/signup")({
  head: ({ match }) => ({
    meta: [
      { title: signupT(isLocale(match.search.lang) ? match.search.lang : "ru")("meta.title") },
    ],
  }),
  // Со страницы ниши лендинга: какая ниша выбрана и откуда пришли. Чужое — молча отбрасывается.
  validateSearch: z.object({
    vertical: z
      .string()
      .optional()
      .catch(undefined)
      .transform((v) =>
        SIGNUP_VERTICALS.includes(v as VerticalKey) ? (v as VerticalKey) : undefined,
      ),
    /** Язык главной, с которой пришли: форма и ошибки — на нём. */
    lang: z.enum(SUPPORTED_LOCALES).optional().catch(undefined),
    from: z.enum(SIGNUP_PAGES).optional().catch(undefined),
    partner: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,29}$/)
      .optional()
      .catch(undefined),
  }),
  loader: () => signupEnabledFn(),
  component: SignupPage,
});

function SignupPage() {
  const { enabled, challenge } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const locale: Locale = search.lang ?? "ru";
  const t = signupT(locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  // Пришли на регистрацию сразу по ссылке с метками — тоже запоминаем.
  useEffect(() => rememberWebSource(PLATFORM_SOURCE_SLUG, window.location.search), []);
  const {
    run,
    busy,
    error: rawError,
  } = useAction(async (f: FormData) => {
    // Задача против ботов решается в браузере за секунду-две, пока кнопка «занята».
    const answer = await solveChallenge(challenge);
    await signupFn({
      data: {
        name: String(f.get("name")),
        username: String(f.get("username")).trim().toLowerCase(),
        password: String(f.get("password")),
        vertical: String(f.get("vertical")),
        contact: String(f.get("contact") || "") || undefined,
        website: String(f.get("website") || ""),
        challenge,
        answer,
        source: readWebSource(PLATFORM_SOURCE_SLUG),
        page: search.from,
        partner: search.partner,
      },
    });
    await navigate({ to: "/admin" });
  });
  const error = rawError ? new Error(signupErrorText(locale, rawError)) : null;
  if (!enabled) {
    return (
      <main className="mx-auto max-w-sm px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">{t("closed.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("closed.text")}</p>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <Link to="/" className="text-lg font-semibold">
          🐸 FrogFlow
        </Link>
        <ThemeToggle />
      </header>
      <section className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-16 md:pt-12">
        <h1 className="text-2xl font-semibold">{t("form.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("form.lead")}</p>
        <form
          className="card mt-6 space-y-4 p-5"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            void run(new FormData(e.currentTarget)).catch(() => {});
          }}
        >
          <Field label={t("form.name")}>
            <input
              className="input"
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder={t("form.namePlaceholder")}
            />
          </Field>
          <Field label={t("form.vertical")}>
            <select className="input" name="vertical" defaultValue={search.vertical ?? "digital"}>
              {SIGNUP_VERTICALS.map((k) => (
                <option key={k} value={k}>
                  {signupVerticalTitle(locale, k, VERTICALS[k].title)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("form.username")} hint={t("form.usernameHint")}>
            <input
              className="input"
              name="username"
              required
              pattern="[a-z0-9][a-z0-9_.\-]{2,39}"
              autoComplete="username"
              placeholder="myshop"
            />
          </Field>
          <Field label={t("form.password")} hint={t("form.passwordHint")}>
            <input
              className="input"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <Field label={t("form.contact")} hint={t("form.contactHint")}>
            <input className="input" name="contact" maxLength={200} />
          </Field>
          <input name="website" className="hidden" tabIndex={-1} autoComplete="off" />
          <ErrorBox error={error} />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? t("form.busy") : t("form.submit")}
          </button>
          <p className="text-center text-xs text-muted">
            {t("form.haveShop")}{" "}
            <Link to="/admin/login" className="text-accent hover:underline">
              {t("form.login")}
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
