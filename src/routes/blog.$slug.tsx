import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { signupEnabledFn } from "@/app/signup/signup.functions";
import { landingT } from "@/app/i18n/landing";
import { rememberWebSource } from "@/app/storefront/source";
import {
  ARTICLES,
  ARTICLES_PUBLISHED,
  ARTICLE_SLUGS,
  articleUrl,
  isArticleSlug,
  type ArticleSlug,
} from "@/app/landing/articles";
import { OG_LOCALE } from "@/app/landing/config";
import type { NichePage } from "@/app/landing/niches";
import { Footer, Header, langSearch, signupSearch } from "@/app/landing/sections";
import { articleJsonLd } from "@/app/landing/structured-data";
import { SUPPORTED_LOCALES, isLocale, type Locale } from "@/core/i18n/locale";
import { PLATFORM_SOURCE_SLUG } from "@/core/signup/origin";
import { jsonLdScript } from "@/core/storefront/seo";

/** Со статьи о школе регистрация идёт с нишей «Онлайн-школа»; у остальных ниши нет. */
const SIGNUP_NICHE: Partial<Record<ArticleSlug, NichePage>> = { "online-school-bot": "courses" };

/**
 * SEO-статья платформы: /blog/<slug>, язык — `?lang=` (русский без параметра,
 * как у главной). Тексты — app/landing/articles; страницы входят в
 * /sitemap-pages.xml.
 */
export const Route = createFileRoute("/blog/$slug")({
  validateSearch: z.object({ lang: z.string().optional() }),
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  loader: async ({ params, deps }) => {
    if (!isArticleSlug(params.slug)) throw notFound();
    // Как на главной: сбой запроса не роняет страницу.
    const res = await signupEnabledFn().catch(() => null);
    const locale: Locale = isLocale(deps.lang) ? deps.lang : "ru";
    return { signup: res?.enabled === true, locale, slug: params.slug };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { locale, slug } = loaderData;
    const a = ARTICLES[slug][locale];
    const url = articleUrl(slug, locale);
    return {
      meta: [
        { title: a.title },
        { name: "description", content: a.description },
        { property: "og:title", content: a.title },
        { property: "og:description", content: a.description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "og:locale", content: OG_LOCALE[locale] },
        { property: "og:site_name", content: "FrogFlow" },
      ],
      scripts: [
        jsonLdScript(
          articleJsonLd({
            url,
            headline: a.h1,
            description: a.description,
            locale,
            published: ARTICLES_PUBLISHED,
          }),
        ),
      ],
      links: [
        { rel: "canonical", href: url },
        ...SUPPORTED_LOCALES.map((l) => ({
          rel: "alternate",
          hrefLang: l,
          href: articleUrl(slug, l),
        })),
        { rel: "alternate", hrefLang: "x-default", href: articleUrl(slug, "ru") },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700&display=swap",
        },
      ],
    };
  },
  component: ArticleView,
});

function ArticleView() {
  const { signup, locale, slug } = Route.useLoaderData();
  const t = landingT(locale);
  const a = ARTICLES[slug][locale];
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  // utm и ref рекламы запоминаются и уйдут с регистрацией (core/signup/origin).
  useEffect(() => rememberWebSource(PLATFORM_SOURCE_SLUG, window.location.search), []);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Header t={t} locale={locale} article={slug} />
      <main>
        <article className="mx-auto w-full max-w-3xl px-4 pt-10 pb-14 md:pt-16">
          <h1 className="font-display text-3xl leading-[1.15] font-bold tracking-tight text-balance md:text-[40px]">
            {a.h1}
          </h1>
          <p className="mt-5 text-lg text-muted">{a.lead}</p>
          {a.sections.map((s) => (
            <section key={s.h} className="mt-10">
              <h2 className="font-display text-xl leading-tight font-bold text-balance md:text-2xl">
                {s.h}
              </h2>
              {s.p.map((text) => (
                <p key={text} className="mt-3 leading-relaxed">
                  {text}
                </p>
              ))}
            </section>
          ))}
          <div className="mt-10">
            {signup ? (
              <Link
                to="/signup"
                search={signupSearch(SIGNUP_NICHE[slug])}
                className="btn-primary px-5 py-3 text-base"
              >
                {a.cta}
              </Link>
            ) : (
              <Link to="/admin/login" className="btn-primary px-5 py-3 text-base">
                {t("hero.ctaLogin")}
              </Link>
            )}
          </div>
          <nav aria-label={t("articles.linksLabel")} className="mt-12 border-t border-line pt-6">
            <ul className="grid gap-2 text-sm font-semibold text-accent">
              {ARTICLE_SLUGS.filter((s) => s !== slug).map((s) => (
                <li key={s}>
                  <Link
                    to="/blog/$slug"
                    params={{ slug: s }}
                    search={langSearch(locale)}
                    className="underline underline-offset-4"
                  >
                    {ARTICLES[s][locale].link}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </article>
      </main>
      <Footer t={t} locale={locale} article />
    </div>
  );
}
