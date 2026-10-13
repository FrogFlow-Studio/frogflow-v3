import { publicHeaders } from "@/app/cache-policy";
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
  OG_IMAGE_META,
  OG_LOCALE,
  REVIEWS,
  TRIAL_DAYS,
  landingUrl,
} from "@/app/landing/config";
import {
  Faq,
  FrogMark,
  FinalCta,
  Footer,
  Header,
  LANDING_FONT_LINKS,
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
        ...OG_IMAGE_META,
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
        // Яндекс по региону Казахстана показывал русскоязычным казахскую версию:
        // русская страница прямо названа и для них (и для Узбекистана).
        ...["ru-KZ", "ru-UZ"].map((l) => ({
          rel: "alternate",
          hrefLang: l,
          href: landingUrl("ru"),
        })),
        { rel: "alternate", hrefLang: "x-default", href: landingUrl("ru") },
        ...LANDING_FONT_LINKS,
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
      className="btn-primary px-6 py-3.5 text-base"
    >
      {t("hero.ctaSignup", { days: TRIAL_DAYS })}
    </Link>
  ) : (
    <Link to="/admin/login" className="btn-primary px-6 py-3.5 text-base">
      {t("hero.ctaLogin")}
    </Link>
  );

  // Вторая фраза заголовка («Вам остаётся одна кнопка») — лаймом.
  const title = t("hero.title");
  const cut = title.indexOf(". ");
  const [titleHead, titleTail] =
    cut > 0 ? [title.slice(0, cut + 1), title.slice(cut + 2)] : [title, ""];

  return (
    <div className="theme-night flex min-h-screen flex-col bg-bg text-fg">
      <Header t={t} locale={locale} />

      <main>
        {/* Первый экран */}
        <section className="bg-[radial-gradient(70%_90%_at_85%_40%,#0f1d09_0%,transparent_60%)]">
          <div className="mx-auto grid w-full max-w-[1440px] items-center gap-12 px-4 xl:gap-20 xl:px-8 pt-12 pb-16 md:grid-cols-[1.12fr_0.88fr] md:pt-16 md:pb-20">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.3em] text-accent uppercase">
                {t("hero.kicker")}
              </p>
              <h1 className="mt-4 font-display text-[38px] leading-[1.02] font-bold text-balance md:text-[64px] xl:text-[78px]">
                {titleHead} {titleTail && <span className="text-accent">{titleTail}</span>}
              </h1>
              <p className="mt-6 max-w-xl text-lg xl:max-w-2xl xl:text-xl text-muted">
                {t("hero.lead")}
              </p>
              <ul className="mt-6 flex flex-wrap gap-2 text-sm">
                {["Telegram", "WhatsApp", "Instagram", t("hero.storefront")].map((c) => (
                  <li
                    key={c}
                    className="flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pr-3.5 pl-2.5"
                  >
                    <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
                    {c}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                {signupCta}
                {DEMO_URL && (
                  <a
                    href={DEMO_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary px-6 py-3.5 text-base"
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
          </div>
        </section>

        {CLIENTS.length > 0 && (
          <section className="border-y border-line bg-surface">
            <div className="mx-auto w-full max-w-[1440px] px-4 xl:px-8 py-9">
              <p className="text-sm text-muted">{t("clients.title")}</p>
              <ul className="mt-5 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
                {CLIENTS.map((c) => {
                  const [what, figures] = c.note[locale].split(" · ");
                  const name = c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold hover:text-accent"
                    >
                      {c.name} ↗
                    </a>
                  ) : (
                    <span className="font-semibold">{c.name}</span>
                  );
                  return (
                    <li key={c.name} className="grid content-start gap-1">
                      {c.stat ? (
                        <>
                          <span className="font-display text-[40px] leading-none text-accent tabular-nums">
                            {c.stat.value}
                          </span>
                          <span className="text-sm text-muted">{c.stat.label[locale]}</span>
                        </>
                      ) : (
                        <span className="font-display text-[28px] leading-[1.15] text-accent">
                          {c.name}
                        </span>
                      )}
                      <span className="mt-2 text-sm">
                        {c.stat && <>{name} · </>}
                        <span className="text-muted">{what}</span>
                      </span>
                      {figures && (
                        <span className="text-sm text-muted tabular-nums">{figures}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        <Scenarios t={t} locale={locale} />

        <ReceiptChecks t={t} />

        <PaymentWays t={t} />

        <Steps t={t} />

        <Pricing t={t} signup={signup} />

        {REVIEWS.length > 0 && (
          <section className="border-y border-line bg-surface">
            <div className="mx-auto w-full max-w-[1440px] px-4 xl:px-8 py-16">
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

type Channel = "tg" | "wa" | "ig";
const CHANNELS: Channel[] = ["tg", "wa", "ig"];
const CHAT_STEPS = 5;
const CHAT_PRICE = "1 900 ₸";
// Без точки в конце: в тексте бота за реквизитами идёт точка.
const CHAT_CARD = "+7 701 ••• 44 17, Айжан К";

/**
 * Первый экран: переписка покупателя с ботом до чека и одна кнопка продавца
 * «Деньги пришли» — что остаётся ему после бота. Только показ, ничего не пишет.
 */
function ChatDemo({ t }: { t: LandingT }) {
  const [channel, setChannel] = useState<Channel>("tg");
  // Сколько сообщений видно: при загрузке вся переписка, «Показать заново» проигрывает её.
  const [shown, setShown] = useState(CHAT_STEPS);
  const [sent, setSent] = useState(false);
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    if (replay === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(CHAT_STEPS);
      return;
    }
    setShown(0);
    const timers = Array.from({ length: CHAT_STEPS }, (_, i) =>
      window.setTimeout(() => setShown(i + 1), 300 + i * 750),
    );
    return () => timers.forEach(clearTimeout);
  }, [replay]);

  const bubble = "night-pop max-w-[85%] rounded-2xl px-3 py-2 text-[14.5px] leading-snug";
  const me = `${bubble} justify-self-end rounded-br-md bg-[#22440f]`;
  const bot = `${bubble} rounded-bl-md bg-surface-2`;
  const file = (name: string) => (
    <span className="flex items-center gap-2.5 text-[13px]">
      <span className="grid h-9 w-7 shrink-0 place-items-center rounded-md bg-accent font-mono text-[9px] font-semibold text-accent-fg">
        PDF
      </span>
      {name}
    </span>
  );
  const messages = [
    <div key="ask" className={me}>
      {t("chat.ask")}
    </div>,
    <div key="product" className={bot}>
      <div className="relative h-14 rounded-lg bg-[repeating-linear-gradient(0deg,#16222a_0_9px,#1d2b33_9px_10px)]" />
      <div className="mt-1.5 font-semibold">{t("confirm.product")}</div>
      <div className="font-mono font-semibold text-[var(--night-lime-hi)] tabular-nums">
        {CHAT_PRICE}
      </div>
      <div className="mt-1.5 rounded-lg bg-[#1a2a30] py-2 text-center text-[13.5px] font-semibold">
        {t("chat.buy")}
      </div>
    </div>,
    <div key="pay" className={bot}>
      {t("chat.pay", { sum: CHAT_PRICE, card: CHAT_CARD })}
    </div>,
    <div key="receipt" className={me}>
      {file(t("chat.receiptFile"))}
    </div>,
    <div key="checked" className={bot}>
      {t("chat.checked")}
      <ul className="mt-1.5 grid gap-0.5 text-[13.5px]">
        {(["confirm.c1", "confirm.c2", "confirm.c3"] as const).map((k) => (
          <li key={k}>
            <span className="text-accent">✓</span> {t(k)}
          </li>
        ))}
      </ul>
      <div className={`mt-1.5 text-[13px] font-semibold ${sent ? "text-accent" : "text-warn"}`}>
        {t(sent ? "chat.paidStatus" : "chat.waitSeller")}
      </div>
    </div>,
  ];

  return (
    <div className="mx-auto w-full max-w-[380px] md:mr-0 xl:max-w-[440px] rounded-[34px] border border-line bg-surface p-3 shadow-[0_40px_100px_-40px_rgb(125_196_55/0.35)]">
      <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-3">
        <FrogMark className="w-9 rounded-full" />
        <div className="min-w-0">
          <b className="block text-[15px]">{t("confirm.shop")}</b>
          <small className="text-xs text-muted">{t(`chat.${channel}`)}</small>
        </div>
        <div role="group" aria-label={t("chat.channel")} className="ml-auto flex gap-1">
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === channel}
              onClick={() => setChannel(c)}
              className={`rounded-full border px-2 py-1.5 text-[11px] leading-none font-semibold uppercase ${
                c === channel
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-line text-muted hover:text-fg"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div
        className="grid min-h-[400px] content-start gap-2 rounded-3xl bg-[#070c0e] px-3 py-3.5"
        aria-live="polite"
      >
        {messages.slice(0, shown)}
        {sent && shown === CHAT_STEPS && (
          <div className={bot}>
            {t("chat.paid")}
            <div className="mt-1.5">{file(t("chat.fileName"))}</div>
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-2">
        <div className="flex justify-between gap-2 px-1 text-xs text-muted">
          <span>{t("seller.panel")}</span>
          <span>{t(sent ? "seller.ready" : "seller.waiting")}</span>
        </div>
        <button
          type="button"
          aria-pressed={sent}
          disabled={shown < CHAT_STEPS}
          onClick={() => setSent((v) => !v)}
          className="night-press w-full rounded-[22px] bg-accent px-4 py-4 text-center text-accent-fg focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-fg"
        >
          <span className="block font-display text-2xl">
            {t(sent ? "confirm.buttonDone" : "confirm.button")}
          </span>
          <span className="mt-1.5 block text-sm">{t("confirm.buttonSub")}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setReplay((n) => n + 1);
          }}
          className="justify-self-center px-2 py-1 text-[13px] text-muted underline underline-offset-4 hover:text-fg"
        >
          {t("chat.replay")}
        </button>
      </div>
    </div>
  );
}

/** Две ступени оплаты: перевод на Kaspi с кнопкой продавца или своя касса без кнопки. */
function PaymentWays({ t }: { t: LandingT }) {
  const card = (key: "kaspi" | "own") => {
    const own = key === "own";
    return (
      <div
        className={`flex flex-col gap-2.5 rounded-[26px] p-7 ${
          own
            ? "border-2 border-accent bg-[linear-gradient(180deg,var(--night-moss),var(--surface)_70%)] md:pt-12"
            : "border border-line bg-surface"
        }`}
      >
        <span
          className={`text-xs font-semibold tracking-[0.3em] uppercase ${own ? "text-accent" : "text-muted"}`}
        >
          {t(`pay.${key}.when`)}
        </span>
        <h3 className="font-display text-2xl leading-tight">{t(`pay.${key}.title`)}</h3>
        <p className="font-semibold">{t(`pay.${key}.who`)}</p>
        <p className="text-muted">{t(`pay.${key}.text`)}</p>
        <p className="mt-auto flex items-center gap-2.5 border-t border-dashed border-line pt-4 text-sm font-semibold">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${own ? "bg-accent" : "bg-warn"}`}
            aria-hidden
          />
          {t(`pay.${key}.status`)}
        </p>
      </div>
    );
  };
  return (
    <section id="pay" className="mx-auto w-full max-w-[1440px] scroll-mt-20 px-4 xl:px-8 py-20">
      <SectionTitle>{t("pay.title")}</SectionTitle>
      <p className="mt-3 max-w-2xl text-muted">{t("pay.sub")}</p>
      <div className="mt-9 grid items-end gap-5 md:grid-cols-2">
        {card("kaspi")}
        {card("own")}
      </div>
      <p className="mt-5 max-w-2xl text-sm text-muted">{t("pay.note")}</p>
    </section>
  );
}

const CHECK_ROWS = ["r1", "r2", "r3", "r4", "r5"] as const;

/**
 * Что бот сверяет в чеке: пример чека с номерами и пояснения к ним. Последний
 * пункт — чего бот не может и почему деньги подтверждает человек.
 */
function ReceiptChecks({ t }: { t: LandingT }) {
  const tag = (n: number) => (
    <span
      className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-accent align-[1px] font-sans text-[11px] font-bold text-accent-fg"
      aria-hidden
    >
      {n}
    </span>
  );
  const row = (label: ReactNode, value: string) => (
    <div className="flex justify-between gap-3">
      <span className="text-[#5b6560]">{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <section id="check" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="mx-auto w-full max-w-[1440px] px-4 xl:px-8 py-20">
        <SectionTitle>{t("check.title")}</SectionTitle>
        <p className="mt-3 max-w-2xl text-muted">{t("check.sub")}</p>
        <div className="mt-10 grid items-start gap-10 md:grid-cols-[340px_1fr] md:gap-14">
          <div
            role="img"
            aria-label={t("check.receipt.label")}
            className="night-receipt max-w-[360px] -rotate-1 rounded-md bg-[#eef2ec] px-5 pt-5 pb-8 font-mono text-[13.5px] leading-[1.7] text-[#111614] tabular-nums"
          >
            <div className="mb-2.5 border-b border-dashed border-[#b8c0bb] pb-2.5 text-center font-semibold">
              {t("check.receipt.title")}
            </div>
            <div className="mt-1.5 mb-3 text-center text-2xl font-semibold">
              {tag(1)}
              {CHAT_PRICE}
            </div>
            {row(
              <>
                {tag(2)}
                {t("check.receipt.recipient")}
              </>,
              "Айжан К.",
            )}
            {row(t("check.receipt.phone"), "+7 701 ••• 44 17")}
            {row(
              <>
                {tag(3)}
                {t("check.receipt.date")}
              </>,
              "08.10.2026 21:14",
            )}
            {row(
              <>
                {tag(4)}
                {t("check.receipt.no")}
              </>,
              "№ 2418905337",
            )}
            {row(
              <>
                {tag(5)}
                {t("check.receipt.status")}
              </>,
              t("check.receipt.ok"),
            )}
          </div>
          <ol className="border-t border-line">
            {CHECK_ROWS.map((r, i) => (
              <li key={r} className="grid grid-cols-[32px_1fr] gap-3 border-b border-line py-4">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold text-accent-fg">
                  {i + 1}
                </span>
                <div>
                  <b className="block">{t(`check.${r}.what`)}</b>
                  <p className="mt-0.5 text-muted">{t(`check.${r}.how`)}</p>
                </div>
              </li>
            ))}
            <li className="mt-4 grid grid-cols-[32px_1fr] gap-3 rounded-2xl border border-[#4a3b14] bg-[#2a2210] p-4">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-warn text-xs font-bold text-[#1c1503]">
                !
              </span>
              <div>
                <b className="block">{t("check.r6.what")}</b>
                <p className="mt-0.5 text-[#e9dfc4]">{t("check.r6.how")}</p>
              </div>
            </li>
          </ol>
        </div>
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
    <section className="mx-auto w-full max-w-[1440px] px-4 xl:px-8 py-20">
      <SectionTitle>{t("scen.title")}</SectionTitle>
      <p className="mt-3 text-muted">{t("scen.sub")}</p>
      <div role="tablist" className="mt-7 flex flex-wrap gap-2">
        {NICHES.map((n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === niche}
            onClick={() => setNiche(n)}
            className={`rounded-full border px-4 py-2.5 text-[15px] font-semibold ${
              n === niche
                ? "border-fg bg-fg text-bg"
                : "border-line bg-surface text-fg hover:border-muted"
            }`}
          >
            {t(`scen.${n}.tab` as LandingKey)}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-0.5 overflow-hidden rounded-3xl bg-line md:grid-cols-2">
        <div className="bg-surface p-7">
          <h3 className="text-xs font-semibold tracking-[0.3em] text-muted uppercase">
            {t("scen.now")}
          </h3>
          <ul className="mt-4 grid gap-3.5 text-muted">
            {["b1", "b2", "b3"].map((s) => (
              <li key={s} className="grid grid-cols-[22px_1fr] gap-2">
                <span aria-hidden>–</span>
                {k(s)}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-[var(--night-moss)] p-7">
          <h3 className="text-xs font-semibold tracking-[0.3em] text-accent uppercase">
            {t("scen.with")}
          </h3>
          <ul className="mt-4 grid gap-3.5">
            {["a1", "a2", "a3"].map((s) => (
              <li key={s} className="grid grid-cols-[22px_1fr] gap-2">
                <span className="font-bold text-accent" aria-hidden>
                  ✓
                </span>
                {k(s)}
              </li>
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
