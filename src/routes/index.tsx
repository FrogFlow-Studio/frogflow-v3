import { publicHeaders } from "@/app/cache-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { signupEnabledFn } from "@/app/signup/signup.functions";
import { siteVerificationFn } from "@/app/landing/verification.functions";
import { yandexVerificationMeta } from "@/app/landing/verification";
import { landingT } from "@/app/i18n/landing";
import { homeT } from "@/app/i18n/home";
import { BRAND } from "@/app/landing/brand";
import { OG_LOCALE, SITE_URL, TRIAL_DAYS, landingUrl } from "@/app/landing/config";
import { LANDING_FONT_LINKS, Pricing } from "@/app/landing/sections";
import {
  Compare,
  Features,
  Flow,
  Hero,
  HomeFaq,
  HomeFinal,
  HomeFooter,
  HomeHeader,
  HomeTitle,
  Payments,
  Proof,
  Segments,
  StickyCta,
  useStickyCta,
  WRAP,
  type HomeProps,
} from "@/app/landing/home";
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
    const t = homeT(locale, BRAND.name);
    const title = t("meta.title");
    const description = t("meta.description", { days: TRIAL_DAYS });
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "theme-color", content: "#f7f8f4" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: landingUrl(locale) },
        { property: "og:locale", content: OG_LOCALE[locale] },
        { property: "og:site_name", content: BRAND.name },
        // Своё превью главной (Enveriq); ниши и статьи пока со старым og.png.
        { property: "og:image", content: `${SITE_URL}${BRAND.ogImage}` },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: title },
        { name: "twitter:card", content: "summary_large_image" },
        ...yandexVerificationMeta(loaderData?.yandex),
      ],
      scripts: [
        jsonLdScript(
          landingJsonLd({
            url: landingUrl(locale),
            name: BRAND.name,
            description,
            locale,
          }),
        ),
      ],
      links: [
        { rel: "canonical", href: landingUrl(locale) },
        ...SUPPORTED_LOCALES.map((l) => ({ rel: "alternate", hrefLang: l, href: landingUrl(l) })),
        // Яндекс по региону Казахстана показывал русскоязычным казахскую версию:
        // русская страница прямо названа и для них (и для Узбекистана).
        ...["ru-KZ", "ru-UZ"].map((l) => ({
          rel: "alternate",
          hrefLang: l,
          href: landingUrl("ru"),
        })),
        { rel: "alternate", hrefLang: "x-default", href: landingUrl("ru") },
        // Логотип на первом экране — без ожидания CSS.
        { rel: "preload", as: "image", href: BRAND.logo.src, type: "image/svg+xml" },
        ...LANDING_FONT_LINKS,
      ],
    };
  },
  component: Landing,
});

/** Главная платформы (Enveriq) — для владельцев магазинов. */
function Landing() {
  const { signup, locale } = Route.useLoaderData();
  const p: HomeProps = {
    t: homeT(locale, BRAND.name),
    lt: landingT(locale),
    locale,
    signup,
  };
  useEffect(() => {
    // Корневой шаблон рисует lang="ru"; для чтения с экрана и переводчика браузера — язык страницы.
    document.documentElement.lang = locale;
  }, [locale]);
  // utm и ref рекламы запоминаются и уйдут с регистрацией (core/signup/origin).
  useEffect(() => rememberWebSource(PLATFORM_SOURCE_SLUG, window.location.search), []);
  const heroCta = useRef<HTMLDivElement>(null);
  const finalRef = useRef<HTMLDivElement>(null);
  const sticky = useStickyCta(heroCta, finalRef);

  return (
    <div className="theme-enveriq flex min-h-screen flex-col bg-bg text-fg">
      <HomeHeader {...p} />
      <main>
        <Hero {...p} ctaRef={heroCta} />
        <Proof {...p} />
        <Flow {...p} />
        <Features {...p} />
        <Payments {...p} />
        <Compare {...p} />
        <Segments {...p} />
        <Pricing t={p.lt} signup={signup} wrap={WRAP} Title={HomeTitle} />
        <HomeFaq {...p} />
        <div ref={finalRef}>
          <HomeFinal {...p} />
        </div>
      </main>
      <HomeFooter {...p} />
      <StickyCta {...p} visible={sticky} />
    </div>
  );
}
