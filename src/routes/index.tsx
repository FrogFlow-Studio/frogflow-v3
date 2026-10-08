import { publicHeaders } from "@/app/cache-policy";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { signupEnabledFn } from "@/app/signup/signup.functions";
import { siteVerificationFn } from "@/app/landing/verification.functions";
import { yandexVerificationMeta } from "@/app/landing/verification";
import { landingT, type LandingKey, type LandingT } from "@/app/i18n/landing";
import {
  CLIENTS,
  DEMO_URL,
  OG_LOCALE,
  REVIEWS,
  TRIAL_DAYS,
  landingUrl,
} from "@/app/landing/config";
import {
  Faq,
  FinalCta,
  Footer,
  Header,
  langSearch,
  NicheLinks,
  Pricing,
  SectionTitle,
  Steps,
} from "@/app/landing/sections";
import { SUPPORTED_LOCALES, isLocale, type Locale } from "@/core/i18n/locale";
import { jsonLdScript } from "@/core/storefront/seo";
import { landingJsonLd } from "@/app/landing/structured-data";
import { rememberWebSource } from "@/app/storefront/source";
import { PLATFORM_SOURCE_SLUG } from "@/core/signup/origin";

export const Route = createFileRoute("/")({
  headers: publicHeaders,
  validateSearch: z.object({ lang: z.string().optional() }),
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  loader: async ({ deps }) => {
    // Сбой запроса не должен ронять главную: клиент TanStack на ответ 500 без
    // сериализации возвращает не ошибку, а что попало (бывало и undefined).
    const res = await signupEnabledFn().catch(() => null);
    const verification = await siteVerificationFn().catch(() => null);
    const locale: Locale = isLocale(deps.lang) ? deps.lang : "ru";
    return { signup: res?.enabled === true, locale, yandex: verification?.yandex ?? null };
  },
  head: ({ loaderData }) => {
    const locale = loaderData?.locale ?? "ru";
    const t = landingT(locale);
    return {
      meta: [
        { title: t("meta.title") },
        { name: "description", content: t("meta.description", { days: TRIAL_DAYS }) },
        { property: "og:title", content: t("meta.title") },
        { property: "og:description", content: t("meta.description", { days: TRIAL_DAYS }) },
        { property: "og:type", content: "website" },
        { property: "og:url", content: landingUrl(locale) },
        { property: "og:locale", content: OG_LOCALE[locale] },
        { property: "og:site_name", content: "FrogFlow" },
        ...yandexVerificationMeta(loaderData?.yandex),
      ],
      scripts: [
        jsonLdScript(
          landingJsonLd({
            url: landingUrl(locale),
            name: t("meta.title"),
            description: t("meta.description", { days: TRIAL_DAYS }),
            locale,
          }),
        ),
      ],
      links: [
        { rel: "canonical", href: landingUrl(locale) },
        ...SUPPORTED_LOCALES.map((l) => ({ rel: "alternate", hrefLang: l, href: landingUrl(l) })),
        { rel: "alternate", hrefLang: "x-default", href: landingUrl("ru") },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700&display=swap",
        },
      ],
    };
  },
  component: Landing,
});

type Niche = "dig" | "phy" | "ai";

/** Главная платформы — для владельцев магазинов. */
function Landing() {
  const { signup, locale } = Route.useLoaderData();
  const t = landingT(locale);
  useEffect(() => {
    // Корневой шаблон рисует lang="ru"; для чтения с экрана и переводчика браузера — язык страницы.
    document.documentElement.lang = locale;
  }, [locale]);
  // utm и ref рекламы запоминаются и уйдут с регистрацией (core/signup/origin).
  useEffect(() => rememberWebSource(PLATFORM_SOURCE_SLUG, window.location.search), []);

  const signupCta = signup ? (
    <Link
      to="/signup"
      search={{ ...langSearch(locale) }}
      className="btn-primary px-5 py-3 text-base"
    >
      {t("hero.ctaSignup", { days: TRIAL_DAYS })}
    </Link>
  ) : (
    <Link to="/admin/login" className="btn-primary px-5 py-3 text-base">
      {t("hero.ctaLogin")}
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Header t={t} locale={locale} />

      <main>
        {/* Первый экран */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-10 pb-14 md:grid-cols-[1.3fr_0.9fr] md:pt-16 md:pb-20">
          <div>
            <h1 className="font-display text-3xl leading-[1.15] font-bold tracking-tight text-balance md:text-[42px]">
              {t("hero.title")}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">{t("hero.lead")}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              {signupCta}
              {DEMO_URL && (
                <a
                  href={DEMO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary px-5 py-3 text-base"
                >
                  {t("hero.ctaDemo")}
                </a>
              )}
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {(["hero.fact1", "hero.fact2", "hero.fact3"] as const).map((k) => (
                <li key={k}>
                  <span className="font-bold text-accent">✓</span> {t(k)}
                </li>
              ))}
            </ul>
          </div>
          <SellerConfirm t={t} />
        </section>

        {CLIENTS.length > 0 && (
          <section className="border-y border-line bg-surface">
            <div className="mx-auto w-full max-w-6xl px-4 py-8">
              <p className="text-sm text-muted">{t("clients.title")}</p>
              <ul className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                {CLIENTS.map((c) => {
                  const [what, figures] = c.note[locale].split(" · ");
                  return (
                    <li key={c.name} className="grid content-start gap-1">
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-display font-bold hover:text-accent"
                        >
                          {c.name} ↗
                        </a>
                      ) : (
                        <span className="font-display font-bold">{c.name}</span>
                      )}
                      <span className="text-sm text-muted">{what}</span>
                      {figures && (
                        <span className="text-sm font-semibold tabular-nums">{figures}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        <PaymentWays t={t} />

        <ReceiptChecks t={t} />

        <Scenarios t={t} locale={locale} />

        <Steps t={t} />

        <Pricing t={t} signup={signup} />

        {REVIEWS.length > 0 && (
          <section className="border-y border-line bg-surface">
            <div className="mx-auto w-full max-w-6xl px-4 py-16">
              <SectionTitle>{t("reviews.title")}</SectionTitle>
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {REVIEWS.map((r) => (
                  <figure key={r.author + r.shop} className="card grid gap-4 p-5">
                    <blockquote className="text-sm">{r.text[locale]}</blockquote>
                    <figcaption className="text-sm">
                      <b>{r.author}</b> <span className="text-muted">· {r.shop}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        <Faq t={t} />

        <FinalCta t={t} signup={signup} />
      </main>

      <Footer t={t} locale={locale} />
    </div>
  );
}

/** Первый экран: заказ у продавца и одна кнопка «Деньги пришли» — что остаётся ему после бота. */
function SellerConfirm({ t }: { t: LandingT }) {
  const [sent, setSent] = useState(false);
  return (
    <div className="mx-auto grid w-full max-w-sm justify-items-center gap-6">
      <div className="w-full rounded-3xl border border-line bg-surface p-4" aria-live="polite">
        <div className="mb-3 text-xs text-muted">{t("confirm.shop")}</div>
        <div className="rounded-2xl bg-bg p-4">
          <div className="font-semibold">{t("confirm.order")}</div>
          <div className="text-2xl font-bold tracking-tight tabular-nums">1 900 ₸</div>
          <div className="text-sm text-muted">{t("confirm.product")}</div>
          <ul className="mt-3 grid gap-1.5 text-sm">
            {(["confirm.c1", "confirm.c2", "confirm.c3"] as const).map((k) => (
              <li key={k} className="flex items-baseline gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
                {t(k)}
              </li>
            ))}
          </ul>
          <div className={`mt-3 text-sm font-semibold ${sent ? "text-accent" : "text-warn"}`}>
            {t(sent ? "confirm.done" : "confirm.wait")}
          </div>
        </div>
      </div>
      <button
        type="button"
        aria-pressed={sent}
        onClick={() => setSent((v) => !v)}
        className={`w-full rounded-3xl bg-accent px-4 py-7 text-center text-accent-fg transition-[transform,box-shadow] duration-75 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-fg motion-reduce:transition-none ${
          sent
            ? "translate-y-2 shadow-[0_2px_0_color-mix(in_oklab,var(--accent),black_35%)]"
            : "shadow-[0_10px_0_color-mix(in_oklab,var(--accent),black_35%)] active:translate-y-2 active:shadow-[0_2px_0_color-mix(in_oklab,var(--accent),black_35%)]"
        }`}
      >
        <span className="block font-display text-2xl font-bold">
          {t(sent ? "confirm.buttonDone" : "confirm.button")}
        </span>
        <span className="mt-2 block text-sm opacity-90">{t("confirm.buttonSub")}</span>
      </button>
      <p className="-mt-2 max-w-xs text-center text-sm text-muted">
        {t(sent ? "confirm.hintDone" : "confirm.hint")}
      </p>
    </div>
  );
}

/** Две ступени оплаты: перевод на Kaspi с кнопкой продавца или своя касса без кнопки. */
function PaymentWays({ t }: { t: LandingT }) {
  const card = (key: "kaspi" | "own") => (
    <div
      className={`flex flex-col gap-2.5 rounded-2xl bg-surface p-6 ${
        key === "own" ? "border-2 border-accent" : "border border-line"
      }`}
    >
      <h3 className="text-lg font-semibold">{t(`pay.${key}.title`)}</h3>
      <p className="text-sm font-medium">{t(`pay.${key}.who`)}</p>
      <p className="text-muted">{t(`pay.${key}.text`)}</p>
      <p className="mt-auto flex items-center gap-2.5 pt-3 text-sm font-medium">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${key === "own" ? "bg-accent" : "bg-warn"}`}
          aria-hidden
        />
        {t(`pay.${key}.status`)}
      </p>
    </div>
  );
  return (
    <section id="pay" className="mx-auto w-full max-w-6xl px-4 py-16">
      <SectionTitle>{t("pay.title")}</SectionTitle>
      <p className="mt-2 max-w-2xl text-muted">{t("pay.sub")}</p>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {card("kaspi")}
        {card("own")}
      </div>
      <p className="mt-4 max-w-2xl text-sm text-muted">{t("pay.note")}</p>
    </section>
  );
}

const CHECK_ROWS = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;

/** Что бот сверяет в чеке и чего не может: последняя строка — почему деньги подтверждает человек. */
function ReceiptChecks({ t }: { t: LandingT }) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-16">
      <SectionTitle>{t("check.title")}</SectionTitle>
      <p className="mt-2 max-w-2xl text-muted">{t("check.sub")}</p>
      <div className="mt-8 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="px-4 py-3 font-semibold">
                {t("check.what")}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {t("check.how")}
              </th>
            </tr>
          </thead>
          <tbody>
            {CHECK_ROWS.map((r) => (
              <tr
                key={r}
                className={`border-b border-line last:border-0 ${r === "r6" ? "text-warn" : ""}`}
              >
                <th scope="row" className="w-1/3 px-4 py-3 align-top font-semibold">
                  {t(`check.${r}.what`)}
                </th>
                <td className="px-4 py-3 align-top">{t(`check.${r}.how`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const NICHES: Niche[] = ["dig", "phy", "ai"];

/** «Было → стало» по нише продавца. */
function Scenarios({ t, locale }: { t: LandingT; locale: Locale }) {
  const [niche, setNiche] = useState<Niche>("dig");
  const k = (s: string) => t(`scen.${niche}.${s}` as LandingKey);
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16">
      <SectionTitle>{t("scen.title")}</SectionTitle>
      <p className="mt-2 text-muted">{t("scen.sub")}</p>
      <div role="tablist" className="mt-6 flex flex-wrap gap-2">
        {NICHES.map((n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === niche}
            onClick={() => setNiche(n)}
            className={`rounded-full border px-4 py-2 text-sm font-medium ${
              n === niche
                ? "border-fg bg-fg text-bg"
                : "border-line bg-surface text-fg hover:bg-surface-2"
            }`}
          >
            {t(`scen.${n}.tab` as LandingKey)}
          </button>
        ))}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line p-6">
          <h3 className="text-xs font-semibold tracking-widest text-muted uppercase">
            {t("scen.now")}
          </h3>
          <ul className="mt-3 grid list-disc gap-2 pl-5">
            {["b1", "b2", "b3"].map((s) => (
              <li key={s}>{k(s)}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-accent/10 p-6">
          <h3 className="text-xs font-semibold tracking-widest text-accent uppercase">
            {t("scen.with")}
          </h3>
          <ul className="mt-3 grid list-disc gap-2 pl-5">
            {["a1", "a2", "a3"].map((s) => (
              <li key={s}>{k(s)}</li>
            ))}
          </ul>
        </div>
      </div>
      <NicheLinks
        t={t}
        locale={locale}
        className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-accent underline-offset-4 [&>a]:underline"
      />
    </section>
  );
}
