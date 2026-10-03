import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
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

type Channel = "tg" | "wa" | "ig";
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
          <ChatDemo t={t} />
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

const CHANNEL_COLORS: Record<Channel, string> = { tg: "#2a9bd8", wa: "#25a55a", ig: "#c1407a" };
const CHANNELS: { key: Channel; name: string }[] = [
  { key: "tg", name: "Telegram" },
  { key: "wa", name: "WhatsApp" },
  { key: "ig", name: "Instagram" },
];

/** Макет переписки: как магазин выглядит у покупателя в каждом канале. */
function ChatDemo({ t }: { t: LandingT }) {
  const [channel, setChannel] = useState<Channel>("tg");
  const color = CHANNEL_COLORS[channel];
  const shop = t(`chat.${channel}.shop` as LandingKey);
  const out = (text: string) => (
    <div
      className="max-w-[86%] self-end rounded-2xl rounded-br-sm px-3 py-2 text-white"
      style={{ background: color }}
    >
      {text}
    </div>
  );
  const bot = (body: ReactNode) => (
    <div className="max-w-[88%] rounded-2xl rounded-bl-sm border border-line bg-surface px-3 py-2">
      {body}
    </div>
  );
  const sub = (text: string) => <div className="mt-1 text-xs text-muted">{text}</div>;
  const messages: Record<Channel, ReactNode[]> = {
    tg: [
      out(t("chat.tg.m1")),
      bot(
        <>
          <div className="font-semibold">{t("chat.tg.product")}</div>
          {sub(t("chat.tg.productSub"))}
          <div className="mt-1 font-bold">1 900 ₸</div>
          <div className="mt-2 flex gap-1.5 text-xs">
            <span className="rounded-md border border-line bg-surface-2 px-2 py-1">
              🛒 {t("chat.tg.addToCart")}
            </span>
            <span className="rounded-md border border-line bg-surface-2 px-2 py-1">★ 4.9 (37)</span>
          </div>
        </>,
      ),
      out(t("chat.tg.m3")),
      bot(t("chat.tg.m4")),
      bot(
        <>
          {t("chat.tg.m5")}
          {sub(`📎 ${t("chat.tg.file")}`)}
        </>,
      ),
    ],
    wa: [
      out(t("chat.wa.m1")),
      bot(
        <>
          {t("chat.wa.m2")}
          <div className="mt-2 grid gap-1 text-xs">
            <span className="rounded-md border border-line bg-surface-2 px-2 py-1">
              {t("chat.wa.item1")}
            </span>
            <span className="rounded-md border border-line bg-surface-2 px-2 py-1">
              {t("chat.wa.item2")}
            </span>
          </div>
        </>,
      ),
      out("1"),
      bot(t("chat.wa.m4")),
      bot(
        <>
          {t("chat.wa.m5")}
          {sub(t("chat.wa.m5sub"))}
        </>,
      ),
    ],
    ig: [
      out(t("chat.ig.m1")),
      bot(t("chat.ig.m2")),
      out(t("chat.ig.m3")),
      bot(t("chat.ig.m4")),
      bot(
        <>
          {t("chat.ig.m5")}
          {sub(t("chat.ig.m5sub"))}
        </>,
      ),
    ],
  };
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl border border-line bg-surface shadow-xl">
      <div role="tablist" className="flex gap-1 border-b border-line bg-surface-2 p-2">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={c.key === channel}
            onClick={() => setChannel(c.key)}
            className={`flex-1 rounded-md px-1 py-2 text-xs font-semibold ${
              c.key === channel ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ background: CHANNEL_COLORS[c.key] }}
            />
            {c.name}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span
          className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white"
          style={{ background: color }}
        >
          {shop.charAt(0)}
        </span>
        <div>
          <div className="text-sm font-semibold">{shop}</div>
          <div className="text-xs text-muted">
            {channel === "ig" ? t("chat.ig.status") : t("chat.online")}
          </div>
        </div>
      </div>
      <div className="flex min-h-[21rem] flex-col gap-2 bg-bg p-4 text-sm leading-snug">
        {messages[channel].map((m, i) => (
          <div key={`${channel}-${i}`} className="flex flex-col">
            {m}
          </div>
        ))}
      </div>
    </div>
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
