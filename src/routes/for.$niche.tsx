import { publicHeaders } from "@/app/cache-policy";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { rememberWebSource } from "@/app/storefront/source";
import { PLATFORM_SOURCE_SLUG } from "@/core/signup/origin";
import { z } from "zod";
import { signupEnabledFn } from "@/app/signup/signup.functions";
import { landingT, type LandingKey } from "@/app/i18n/landing";
import { DEMO_URL, TRIAL_DAYS } from "@/app/landing/config";
import {
  NICHE_PRICING,
  coursesFromTier,
  trialCoversNiche,
  isNichePage,
  nichePageOpen,
  nichePageUrl,
} from "@/app/landing/niches";
import {
  Faq,
  FinalCta,
  Footer,
  Header,
  NicheLinks,
  Pricing,
  SectionTitle,
  Steps,
  signupSearch,
} from "@/app/landing/sections";
import { SUPPORTED_LOCALES, isLocale, type Locale } from "@/core/i18n/locale";
import { jsonLdScript } from "@/core/storefront/seo";
import { landingJsonLd } from "@/app/landing/structured-data";
import { OG_LOCALE } from "@/app/landing/config";
import { TIER_TITLES } from "@/core/plans/registry";

/**
 * Страница главной под нишу (`app/landing/niches`): свой заголовок и
 * описание для поиска и рекламы, тарифы ниши из реестра планов.
 */
export const Route = createFileRoute("/for/$niche")({
  headers: publicHeaders,
  validateSearch: z.object({ lang: z.string().optional() }),
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  loader: async ({ params, deps }) => {
    const niche = params.niche;
    if (!isNichePage(niche) || !nichePageOpen(niche)) throw notFound();
    // Как на главной: сбой запроса не роняет страницу.
    const res = await signupEnabledFn().catch(() => null);
    const locale: Locale = isLocale(deps.lang) ? deps.lang : "ru";
    return { signup: res?.enabled === true, locale, niche };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { locale, niche } = loaderData;
    const t = landingT(locale);
    const title = t(`niche.${niche}.title` as LandingKey);
    const description = t(`niche.${niche}.description` as LandingKey, { days: TRIAL_DAYS });
    const url = nichePageUrl(niche, locale);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { property: "og:locale", content: OG_LOCALE[locale] },
        { property: "og:site_name", content: "FrogFlow" },
      ],
      scripts: [jsonLdScript(landingJsonLd({ url, name: title, description, locale }))],
      links: [
        { rel: "canonical", href: url },
        ...SUPPORTED_LOCALES.map((l) => ({
          rel: "alternate",
          hrefLang: l,
          href: nichePageUrl(niche, l),
        })),
        { rel: "alternate", hrefLang: "x-default", href: nichePageUrl(niche, "ru") },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700&display=swap",
        },
      ],
    };
  },
  component: NichePageView,
});

function NichePageView() {
  const { signup, locale, niche } = Route.useLoaderData();
  const t = landingT(locale);
  const k = (s: string, vars?: Record<string, string | number>) =>
    t(`niche.${niche}.${s}` as LandingKey, vars);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  // utm и ref рекламы запоминаются и уйдут с регистрацией (core/signup/origin).
  useEffect(() => rememberWebSource(PLATFORM_SOURCE_SLUG, window.location.search), []);
  const tier = niche === "courses" ? coursesFromTier() : null;

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Header t={t} locale={locale} niche={niche} />

      <main>
        <section className="mx-auto w-full max-w-6xl px-4 pt-10 pb-14 md:pt-16 md:pb-20">
          <h1 className="max-w-3xl font-display text-3xl leading-[1.15] font-bold tracking-tight text-balance md:text-[42px]">
            {k("h1")}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">{k("lead")}</p>
          {tier && (
            <p className="mt-3 text-sm font-semibold text-accent">
              {t("niche.courses.fromTier", { tier: TIER_TITLES[tier] })}
            </p>
          )}
          <div className="mt-7 flex flex-wrap gap-3">
            {signup ? (
              <Link
                to="/signup"
                search={signupSearch(niche)}
                className="btn-primary px-5 py-3 text-base"
              >
                {trialCoversNiche(niche)
                  ? t("hero.ctaSignup", { days: TRIAL_DAYS })
                  : t("final.cta")}
              </Link>
            ) : (
              <Link to="/admin/login" className="btn-primary px-5 py-3 text-base">
                {t("hero.ctaLogin")}
              </Link>
            )}
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
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16">
            <SectionTitle>{t("niche.featuresTitle")}</SectionTitle>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2">
              {([1, 2, 3, 4] as const).map((n) => (
                <li key={n} className="grid content-start gap-1.5">
                  <h3 className="font-semibold">
                    <span className="font-bold text-accent">✓</span> {k(`f${n}.title`)}
                  </h3>
                  <p className="text-sm text-muted">{k(`f${n}.text`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-16">
          <SectionTitle>{t("scen.title")}</SectionTitle>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
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
        </section>

        <Steps t={t} />
        <Pricing t={t} signup={signup} niche={NICHE_PRICING[niche]} page={niche} />
        <Faq t={t} />

        <section className="mx-auto w-full max-w-6xl px-4 pb-16">
          <h2 className="font-semibold">{t("niche.others")}</h2>
          <NicheLinks
            t={t}
            locale={locale}
            except={niche}
            className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-accent underline-offset-4 [&>a]:underline"
          />
          <Link
            to="/"
            search={{ lang: locale === "ru" ? undefined : locale }}
            className="mt-3 inline-block text-sm text-muted hover:text-fg"
          >
            {t("niche.allPlatform")}
          </Link>
        </section>

        <FinalCta t={t} signup={signup} page={niche} />
      </main>

      <Footer t={t} locale={locale} />
    </div>
  );
}
