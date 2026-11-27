/**
 * Главная `/` под брендом Enveriq: шапка, первый экран с живой перепиской,
 * клиенты с цифрами, возможности, оплата и чек Kaspi, «один сервис вместо
 * пяти», вопросы, призыв и подвал. Общие с нишами блоки (три шага, тарифы)
 * берутся из `./sections`, их тексты — из `i18n/landing`; тексты только
 * главной — из `i18n/home`. Ниши и статьи пока остаются со старой шапкой.
 */
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import type { HomeKey, HomeT } from "@/app/i18n/home";
import type { LandingKey, LandingT } from "@/app/i18n/landing";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { BRAND } from "./brand";
import {
  CLIENTS,
  CLIENTS_AS_OF,
  CONTACTS,
  DEMO_URL,
  PLAN_PRICES,
  PLATFORM_ORDERS,
  TRIAL_DAYS,
  formatTenge,
} from "./config";
import { ARTICLES, ARTICLE_SLUGS } from "./articles";
import { NicheLinks, langSearch } from "./sections";

export type HomeProps = { t: HomeT; lt: LandingT; locale: Locale; signup: boolean };

const LANG_LABELS: Record<Locale, string> = { ru: "RU", kk: "KZ", en: "EN", uz: "UZ" };
export const WRAP = "mx-auto w-full max-w-[1280px] px-4 md:px-6 xl:px-8";

/** Логотип Enveriq с подписью студии; подпись прячется на узком экране. */
export function BrandLogo({
  byline = true,
  className = "",
}: {
  byline?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-3 ${className}`}>
      <img
        src={BRAND.logo.src}
        alt={BRAND.name}
        width={BRAND.logo.width}
        height={BRAND.logo.height}
        className="h-7 w-auto md:h-8"
      />
      {byline && (
        <span className="hidden border-l border-line pl-3 text-[11px] leading-tight text-muted lg:block">
          {BRAND.byline}
        </span>
      )}
    </span>
  );
}

/** Кнопка регистрации; регистрация закрыта — вход в панель. */
function SignupLink({
  locale,
  signup,
  className,
  children,
}: {
  locale: Locale;
  signup: boolean;
  className: string;
  children: ReactNode;
}) {
  return signup ? (
    <Link to="/signup" search={{ ...langSearch(locale) }} className={className}>
      {children}
    </Link>
  ) : (
    <Link to="/admin/login" className={className}>
      {children}
    </Link>
  );
}

export function HomeHeader({ t, locale, signup }: HomeProps) {
  const links = (
    <>
      <a href="#features" className="text-muted hover:text-fg">
        {t("nav.features")}
      </a>
      <a href="#pay" className="text-muted hover:text-fg">
        {t("nav.pay")}
      </a>
      <a href="#pricing" className="text-muted hover:text-fg">
        {t("nav.pricing")}
      </a>
      <a href="#faq" className="text-muted hover:text-fg">
        {t("nav.faq")}
      </a>
    </>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className={`${WRAP} flex items-center gap-6 py-3`}>
        <Link to="/" search={langSearch(locale)} aria-label={BRAND.name} className="shrink-0">
          <BrandLogo />
        </Link>
        <nav aria-label={t("nav.features")} className="hidden gap-6 text-sm md:flex">
          {links}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div
            role="group"
            aria-label={t("nav.language")}
            className="flex overflow-hidden rounded-full border border-line text-xs"
          >
            {SUPPORTED_LOCALES.map((l) => (
              <Link
                key={l}
                to="/"
                search={langSearch(l)}
                hrefLang={l}
                aria-current={l === locale ? "true" : undefined}
                className={`px-2.5 py-1.5 font-medium ${
                  l === locale ? "bg-accent/15 text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {LANG_LABELS[l]}
              </Link>
            ))}
          </div>
          <Link to="/admin/login" className="text-sm font-semibold hover:text-accent">
            {t("nav.login")}
          </Link>
          <span className="hidden lg:block">
            <SignupLink locale={locale} signup={signup} className="btn-primary px-4 py-2 text-sm">
              {t("nav.cta")}
            </SignupLink>
          </span>
        </div>
      </div>
      <nav
        aria-label={t("nav.features")}
        className="flex gap-5 overflow-x-auto px-4 pb-2.5 text-sm whitespace-nowrap md:hidden"
      >
        {links}
      </nav>
    </header>
  );
}

const Check = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-accent" aria-hidden>
    <path
      d="M3 8.5l3 3 7-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Первый экран: обещание, кнопки и живая переписка. `ctaRef` — для нижней кнопки на телефоне. */
export function Hero({
  t,
  lt,
  locale,
  signup,
  ctaRef,
}: HomeProps & { ctaRef: Ref<HTMLDivElement> }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_80%_30%,rgb(140_207_46/0.16)_0%,transparent_65%),radial-gradient(40%_50%_at_0%_100%,rgb(140_207_46/0.07)_0%,transparent_70%)]"
      />
      <div aria-hidden className="enveriq-grid pointer-events-none absolute inset-0 opacity-60" />
      <div
        className={`${WRAP} relative grid items-center gap-10 pt-10 pb-14 md:grid-cols-[1.1fr_0.9fr] md:gap-12 md:pt-16 md:pb-20 xl:gap-20`}
      >
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 py-1.5 pr-3.5 pl-2.5 text-[13px] text-muted">
            <span
              className="h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]"
              aria-hidden
            />
            {t("hero.eyebrow")}
          </p>
          <h1 className="mt-5 font-display text-[40px] leading-[1.02] text-balance sm:text-[48px] md:text-[54px] xl:text-[66px]">
            {t("hero.titleHead")}{" "}
            <span className="whitespace-nowrap text-accent">{t("hero.titleTail")}</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted md:text-lg xl:max-w-2xl">
            {t("hero.lead")}
          </p>
          <div ref={ctaRef} className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <SignupLink
              locale={locale}
              signup={signup}
              className="btn-primary justify-center px-7 py-4 text-base shadow-[0_10px_40px_-10px_rgb(140_207_46/0.6)]"
            >
              {signup ? t("hero.ctaSignup", { days: TRIAL_DAYS }) : t("hero.ctaLogin")}
            </SignupLink>
            {DEMO_URL && (
              <a
                href={DEMO_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary justify-center px-7 py-4 text-base"
              >
                {t("hero.ctaDemo")}
              </a>
            )}
          </div>
          <ul className="mt-6 grid gap-2 text-sm text-muted sm:flex sm:flex-wrap sm:gap-x-6">
            {(["hero.r1", "hero.r2", "hero.r3"] as const).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <Check />
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <ChatDemo t={t} lt={lt} />
      </div>
    </section>
  );
}

/** Клиенты с цифрами из базы; на телефоне — лента с прокруткой вбок. */
export function Proof({ t, locale }: HomeProps) {
  if (CLIENTS.length === 0) return null;
  return (
    <section aria-labelledby="proof-title" className="border-y border-line bg-surface">
      <div className={`${WRAP} py-10 md:py-12`}>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <div>
            <h2 id="proof-title" className="text-sm font-semibold tracking-wide text-muted">
              {t("proof.title")}
            </h2>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-display text-[48px] leading-none text-accent tabular-nums md:text-[56px]">
                {PLATFORM_ORDERS}
              </span>
              <span className="max-w-[260px] text-sm text-muted">{t("proof.total")}</span>
            </p>
          </div>
          <p className="text-xs text-muted">{t("proof.asOf", { date: CLIENTS_AS_OF })}</p>
        </div>
        <ul className="-mx-4 mt-7 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-5">
          {CLIENTS.map((c) => {
            const [what, figures] = c.note[locale].split(" · ");
            return (
              <li
                key={c.name}
                className="flex w-[74%] shrink-0 snap-start flex-col gap-1 rounded-2xl border border-line bg-bg p-5 sm:w-[44%] md:w-auto"
              >
                {c.stat ? (
                  <>
                    <span className="font-display text-[32px] leading-none tabular-nums">
                      {c.stat.value}
                    </span>
                    <span className="text-sm text-muted">{c.stat.label[locale]}</span>
                  </>
                ) : (
                  <>
                    <span className="font-display text-[22px] leading-[32px] text-accent">
                      {LAUNCH_LABEL[locale]}
                    </span>
                  </>
                )}
                <span className="mt-auto border-t border-line pt-3 font-semibold">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-accent">
                      {c.name} <span aria-hidden>↗</span>
                    </a>
                  ) : (
                    c.name
                  )}
                </span>
                <span className="text-sm text-muted">{what}</span>
                {figures && <span className="text-sm text-muted">{figures}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Подпись над клиентом без цифр (запуск недавний). */
const LAUNCH_LABEL: Record<Locale, string> = {
  ru: "Новый запуск",
  kk: "Жаңа іске қосу",
  en: "New launch",
  uz: "Yangi ishga tushirish",
};

const ICONS: Record<string, ReactNode> = {
  shop: <path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 7Zm4 0a4 4 0 0 1 8 0" />,
  ai: (
    <>
      <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      <path d="M12 8l.9 1.8L15 10.5l-2.1.7L12 13l-.9-1.8L9 10.5l2.1-.7L12 8Z" />
    </>
  ),
  pay: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  deliver: <path d="M5 12l4 4 10-10M5 19h14" />,
  site: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 9h16M9 20V9" />
    </>
  ),
  panel: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M10 17h4M10 8h4M10 11h4" />
    </>
  ),
};
const FEATURES = ["shop", "ai", "pay", "deliver", "site", "panel"] as const;

export function Features({ t, lt, locale }: HomeProps) {
  return (
    <section id="features" className={`${WRAP} scroll-mt-24 py-16 md:py-24`}>
      <HomeTitle sub={t("feat.sub")}>{t("feat.title")}</HomeTitle>
      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        {FEATURES.map((f) => (
          <li
            key={f}
            className="flex gap-4 rounded-3xl border border-line bg-surface p-5 transition-colors hover:border-accent/60 sm:block sm:p-6"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {ICONS[f]}
              </svg>
            </span>
            <div>
              <h3 className="text-lg font-semibold sm:mt-4">{t(`feat.${f}.title` as HomeKey)}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                {t(`feat.${f}.text` as HomeKey)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-muted">{t("feat.tiers")}</p>
      <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="mr-1 text-muted">{t("feat.niches")}</span>
        <NicheLinks
          t={lt}
          locale={locale}
          className="contents [&>a]:rounded-full [&>a]:border [&>a]:border-line [&>a]:px-3.5 [&>a]:py-1.5 [&>a]:font-medium [&>a:hover]:border-accent"
        />
      </div>
    </section>
  );
}

export function HomeTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="max-w-3xl">
      <h2 className="font-display text-[30px] leading-[1.08] text-balance md:text-[44px]">
        {children}
      </h2>
      {sub && <p className="mt-4 text-[17px] leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}

const CHECK_ROWS = ["r1", "r2", "r3", "r4", "r5"] as const;
const CHAT_PRICE = "1 900 ₸";
// Без точки в конце: в тексте бота за реквизитами идёт точка.
const CHAT_CARD = "+7 701 ••• 44 17, Айжан К";

/** Оплата: чек Kaspi с пояснениями и два способа принимать деньги. */
export function Payments({ t, lt }: HomeProps) {
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
  const way = (key: "kaspi" | "own") => {
    const own = key === "own";
    return (
      <div
        className={`flex flex-col gap-2 rounded-3xl p-6 ${
          own
            ? "border border-accent/70 bg-[linear-gradient(160deg,var(--night-moss),var(--surface)_75%)]"
            : "border border-line bg-surface"
        }`}
      >
        <span
          className={`text-xs font-semibold tracking-[0.2em] uppercase ${own ? "text-accent" : "text-muted"}`}
        >
          {lt(`pay.${key}.when`)}
        </span>
        <h3 className="text-xl font-semibold">{lt(`pay.${key}.title`)}</h3>
        <p className="text-[15px] text-muted">{lt(`pay.${key}.text`)}</p>
        <p className="mt-auto flex items-center gap-2.5 border-t border-dashed border-line pt-4 text-sm font-semibold">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${own ? "bg-accent" : "bg-warn"}`}
            aria-hidden
          />
          {lt(`pay.${key}.status`)}
        </p>
      </div>
    );
  };
  return (
    <section id="pay" className="scroll-mt-24 border-y border-line bg-surface/60">
      <div className={`${WRAP} py-16 md:py-24`}>
        <HomeTitle sub={t("pay.sub")}>{t("pay.title")}</HomeTitle>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {way("kaspi")}
          {way("own")}
        </div>
        <h3 className="mt-14 text-xl font-semibold">{t("pay.checksTitle")}</h3>
        <div className="mt-6 grid items-start gap-8 md:grid-cols-[320px_1fr] md:gap-14">
          <div
            role="img"
            aria-label={lt("check.receipt.label")}
            className="night-receipt hidden w-full max-w-[340px] -rotate-1 md:block rounded-md bg-[#eef2ec] px-5 pt-5 pb-8 font-mono text-[13.5px] leading-[1.7] text-[#111614] tabular-nums"
          >
            <div className="mb-2.5 border-b border-dashed border-[#b8c0bb] pb-2.5 text-center font-semibold">
              {lt("check.receipt.title")}
            </div>
            <div className="mt-1.5 mb-3 text-center text-2xl font-semibold">
              {tag(1)}
              {CHAT_PRICE}
            </div>
            {row(
              <>
                {tag(2)}
                {lt("check.receipt.recipient")}
              </>,
              "Айжан К.",
            )}
            {row(lt("check.receipt.phone"), "+7 701 ••• 44 17")}
            {row(
              <>
                {tag(3)}
                {lt("check.receipt.date")}
              </>,
              "08.10.2026 21:14",
            )}
            {row(
              <>
                {tag(4)}
                {lt("check.receipt.no")}
              </>,
              "№ 2418905337",
            )}
            {row(
              <>
                {tag(5)}
                {lt("check.receipt.status")}
              </>,
              lt("check.receipt.ok"),
            )}
          </div>
          <div>
            <ol className="grid gap-x-8 border-t border-line sm:grid-cols-2">
              {CHECK_ROWS.map((r, i) => (
                <li key={r} className="grid grid-cols-[28px_1fr] gap-3 border-b border-line py-4">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold text-accent-fg">
                    {i + 1}
                  </span>
                  <div>
                    <b className="block font-semibold">{lt(`check.${r}.what`)}</b>
                    <p className="mt-0.5 text-sm text-muted">{lt(`check.${r}.how`)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-5 grid grid-cols-[28px_1fr] gap-3 rounded-2xl border border-[#4a3b14] bg-[#2a2210] p-4">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-warn text-xs font-bold text-[#1c1503]">
                !
              </span>
              <div>
                <b className="block font-semibold">{lt("check.r6.what")}</b>
                <p className="mt-0.5 text-sm text-[#e9dfc4]">{lt("check.r6.how")}</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted">{lt("pay.note")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** «Один сервис вместо пяти»: без названий конкурентов и без чужих цен. */
export function Compare({ t, locale, signup }: HomeProps) {
  return (
    <section className={`${WRAP} py-16 md:py-24`}>
      <HomeTitle sub={t("compare.sub")}>{t("compare.title")}</HomeTitle>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-line bg-surface p-6 md:p-8">
          <h3 className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
            {t("compare.usual")}
          </h3>
          <ul className="mt-5 grid gap-2.5">
            {(["r1", "r2", "r3", "r4", "r5"] as const).map((r, i) => (
              <li
                key={r}
                className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-muted"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface-2 text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                {t(`compare.${r}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col rounded-3xl border border-accent/70 bg-[radial-gradient(120%_120%_at_100%_0%,var(--night-moss)_0%,var(--surface)_60%)] p-6 md:p-8">
          <h3 className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">
            {t("compare.one")}
          </h3>
          <img
            src={BRAND.mark.src}
            alt=""
            width={BRAND.mark.width}
            height={BRAND.mark.height}
            className="mt-6 h-16 w-16 rounded-2xl"
          />
          <p className="mt-5 font-display text-3xl leading-tight">{t("compare.oneTitle")}</p>
          <p className="mt-3 text-[17px] leading-relaxed text-muted">
            {t("compare.oneText", { price: formatTenge(PLAN_PRICES.basic) })}
          </p>
          <div className="mt-auto pt-8">
            <SignupLink
              locale={locale}
              signup={signup}
              className="btn-primary px-6 py-3.5 text-base"
            >
              {t("nav.cta")}
            </SignupLink>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HomeFaq({ t, lt }: HomeProps) {
  const items: Array<[string, string]> = [
    [lt("faq.1.q"), lt("faq.1.a")],
    [lt("faq.2.q"), lt("faq.2.a")],
    [t("faq.confirm.q"), t("faq.confirm.a")],
    [t("faq.countries.q"), t("faq.countries.a")],
    [t("faq.rename.q"), t("faq.rename.a")],
    [lt("faq.5.q"), lt("faq.5.a")],
  ];
  return (
    <section id="faq" className="mx-auto w-full max-w-3xl scroll-mt-24 px-4 py-16 md:py-24">
      <h2 className="font-display text-[30px] leading-tight md:text-[44px]">{t("faq.title")}</h2>
      <div className="mt-8 border-b border-line">
        {items.map(([q, a], i) => (
          <details key={q} className="group border-t border-line" open={i === 0}>
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
              {q}
              <span
                aria-hidden
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-lg text-muted group-open:rotate-45 motion-safe:transition-transform"
              >
                +
              </span>
            </summary>
            <p className="pb-5 leading-relaxed text-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function HomeFinal({ t, locale, signup }: HomeProps) {
  const contacts = [
    CONTACTS.telegram && {
      label: "Telegram",
      value: `@${CONTACTS.telegram}`,
      href: `https://t.me/${CONTACTS.telegram}`,
      short: "TG",
      color: "#2a9bd8",
    },
    CONTACTS.whatsapp && {
      label: "WhatsApp",
      value: `+${CONTACTS.whatsapp}`,
      href: `https://wa.me/${CONTACTS.whatsapp}`,
      short: "WA",
      color: "#1f8f4d",
    },
  ].filter(
    (c): c is { label: string; value: string; href: string; short: string; color: string } => !!c,
  );
  return (
    <section className={WRAP}>
      <div className="relative overflow-hidden rounded-[32px] border border-accent/40 bg-[radial-gradient(110%_130%_at_0%_0%,var(--night-moss)_0%,var(--bg)_60%)] px-6 py-10 md:px-12 md:py-14">
        <div aria-hidden className="enveriq-grid pointer-events-none absolute inset-0 opacity-50" />
        <div
          className={`relative grid items-center gap-8 ${contacts.length ? "lg:grid-cols-[1.4fr_1fr]" : ""}`}
        >
          <div>
            <h2 className="font-display text-[32px] leading-[1.05] text-balance md:text-[48px]">
              {t("final.title")}
            </h2>
            <p className="mt-4 max-w-xl text-[17px] text-muted">
              {t("final.text", { days: TRIAL_DAYS })}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {signup && (
                <SignupLink
                  locale={locale}
                  signup={signup}
                  className="btn-primary justify-center px-7 py-4 text-base"
                >
                  {t("final.cta")}
                </SignupLink>
              )}
              <Link to="/admin/login" className="btn-secondary justify-center px-7 py-4 text-base">
                {t("final.login")}
              </Link>
            </div>
          </div>
          {contacts.length > 0 && (
            <div className="grid gap-3">
              <p className="text-sm text-muted">{t("final.contacts")}</p>
              {contacts.map((c) => (
                <a
                  key={c.label}
                  href={c.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-2xl border border-line bg-surface/80 px-4 py-3 hover:border-accent"
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                    style={{ background: c.color }}
                    aria-hidden
                  >
                    {c.short}
                  </span>
                  <span>
                    <span className="block text-xs text-muted">{c.label}</span>
                    <span className="font-semibold">{c.value}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function HomeFooter({ t, lt, locale }: HomeProps) {
  return (
    <footer className="mt-16 border-t border-line pb-24 md:pb-0">
      <div className={`${WRAP} grid gap-8 py-10 md:grid-cols-[1.2fr_1fr_1fr]`}>
        <div className="grid content-start gap-3">
          <BrandLogo byline={false} />
          <a
            href={BRAND.studioUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted hover:text-fg"
          >
            {BRAND.byline}
          </a>
          <p className="text-sm text-muted">{t("footer.tagline")}</p>
          <p className="text-xs text-muted">
            © {new Date().getFullYear()} {BRAND.name} · {t("footer.formerly")}
          </p>
        </div>
        <NicheLinks
          t={lt}
          locale={locale}
          className="grid content-start gap-2 text-sm text-muted [&>a]:w-fit"
        />
        <div className="grid content-start gap-2 text-sm text-muted">
          <nav aria-label={lt("articles.linksLabel")} className="grid gap-2 [&>a]:w-fit">
            {ARTICLE_SLUGS.map((slug) => (
              <Link
                key={slug}
                to="/blog/$slug"
                params={{ slug }}
                search={langSearch(locale)}
                className="hover:text-fg"
              >
                {ARTICLES[slug][locale].link}
              </Link>
            ))}
          </nav>
          <a href="#pricing" className="w-fit hover:text-fg">
            {t("nav.pricing")}
          </a>
          <Link to="/admin/login" className="w-fit hover:text-fg">
            {t("footer.login")}
          </Link>
        </div>
      </div>
    </footer>
  );
}

/**
 * Кнопка внизу экрана на телефоне: появляется, когда кнопки первого экрана
 * ушли из вида, и прячется у последнего призыва и подвала.
 */
export function StickyCta({ t, locale, signup, visible }: HomeProps & { visible: boolean }) {
  return (
    <div
      inert={!visible}
      data-testid="sticky-cta"
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/92 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-md transition-transform duration-200 md:hidden ${
        visible ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
    >
      <SignupLink
        locale={locale}
        signup={signup}
        className="btn-primary w-full justify-center py-3.5 text-base"
      >
        {signup ? t("hero.ctaSignup", { days: TRIAL_DAYS }) : t("hero.ctaLogin")}
      </SignupLink>
    </div>
  );
}

/** Видимость нижней кнопки: кнопки первого экрана не видны, финальный блок ещё не виден. */
export function useStickyCta(
  heroCta: RefObject<HTMLElement | null>,
  end: RefObject<HTMLElement | null>,
) {
  const [state, setState] = useState({ heroGone: false, endSeen: false });
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === heroCta.current)
          setState((s) => ({ ...s, heroGone: !e.isIntersecting && e.boundingClientRect.top < 0 }));
        if (e.target === end.current)
          setState((s) => ({ ...s, endSeen: e.isIntersecting || e.boundingClientRect.top < 0 }));
      }
    });
    if (heroCta.current) io.observe(heroCta.current);
    if (end.current) io.observe(end.current);
    return () => io.disconnect();
  }, [heroCta, end]);
  return state.heroGone && !state.endSeen;
}

type Channel = "tg" | "wa" | "ig";
const CHANNELS: Channel[] = ["tg", "wa", "ig"];
const CHAT_STEPS = 5;

/**
 * Переписка покупателя с ботом до чека и одна кнопка продавца «Деньги
 * пришли» — что остаётся ему после бота. Только показ, ничего не пишет.
 */
function ChatDemo({ t, lt }: { t: HomeT; lt: LandingT }) {
  const [channel, setChannel] = useState<Channel>("tg");
  // Сколько сообщений видно: при загрузке вся переписка, «Показать заново» проигрывает её.
  const [shown, setShown] = useState(CHAT_STEPS);
  const [sent, setSent] = useState(false);
  const [replay, setReplay] = useState(0);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    if (replay === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(CHAT_STEPS);
      return;
    }
    setShown(0);
    timers.current = Array.from({ length: CHAT_STEPS }, (_, i) =>
      window.setTimeout(() => setShown(i + 1), 300 + i * 750),
    );
    return () => timers.current.forEach(clearTimeout);
  }, [replay]);

  const bubble = "night-pop max-w-[86%] rounded-2xl px-3 py-2 text-[14.5px] leading-snug";
  const me = `${bubble} justify-self-end rounded-br-md bg-[#26480f]`;
  const bot = `${bubble} rounded-bl-md bg-surface-2`;
  const file = (name: string) => (
    <span className="flex items-center gap-2.5 text-[13px]">
      <span className="grid h-9 w-7 shrink-0 place-items-center rounded-md bg-accent font-mono text-[9px] font-semibold text-accent-fg">
        PDF
      </span>
      {name}
    </span>
  );
  const key = (k: string) => k as LandingKey;
  const messages = [
    <div key="ask" className={me}>
      {lt("chat.ask")}
    </div>,
    <div key="product" className={bot}>
      <div className="relative h-14 rounded-lg bg-[repeating-linear-gradient(0deg,#16222a_0_9px,#1d2b33_9px_10px)]" />
      <div className="mt-1.5 font-semibold">{lt("confirm.product")}</div>
      <div className="font-mono font-semibold text-[var(--night-lime-hi)] tabular-nums">
        {CHAT_PRICE}
      </div>
      <div className="mt-1.5 rounded-lg bg-[#1a2a30] py-2 text-center text-[13.5px] font-semibold">
        {lt("chat.buy")}
      </div>
    </div>,
    <div key="pay" className={bot}>
      {lt("chat.pay", { sum: CHAT_PRICE, card: CHAT_CARD })}
    </div>,
    <div key="receipt" className={me}>
      {file(lt("chat.receiptFile"))}
    </div>,
    <div key="checked" className={bot}>
      {lt("chat.checked")}
      <ul className="mt-1.5 grid gap-0.5 text-[13.5px]">
        {(["confirm.c1", "confirm.c2", "confirm.c3"] as const).map((k) => (
          <li key={k}>
            <span className="text-accent">✓</span> {lt(k)}
          </li>
        ))}
      </ul>
      <div className={`mt-1.5 text-[13px] font-semibold ${sent ? "text-accent" : "text-warn"}`}>
        {lt(sent ? "chat.paidStatus" : "chat.waitSeller")}
      </div>
    </div>,
  ];

  return (
    <div className="relative mx-auto w-full max-w-[400px] md:mr-0 xl:max-w-[440px]">
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-[48px] bg-[radial-gradient(closest-side,rgb(140_207_46/0.22),transparent)] blur-2xl"
      />
      <div className="rounded-[34px] border border-line bg-surface p-3 shadow-[0_40px_100px_-40px_rgb(140_207_46/0.4)]">
        <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-3">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#2b3a1c] font-semibold text-accent"
          >
            {t("chat.avatar")}
          </span>
          <div className="min-w-0">
            <b className="block text-[15px]">{lt("confirm.shop")}</b>
            <small className="text-xs text-muted">{lt(key(`chat.${channel}`))}</small>
          </div>
          <div role="group" aria-label={lt("chat.channel")} className="ml-auto flex gap-1">
            {CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={c === channel}
                onClick={() => setChannel(c)}
                className={`min-h-9 rounded-full border px-2.5 text-[11px] leading-none font-semibold uppercase ${
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
          className="grid min-h-[392px] content-start gap-2 rounded-3xl bg-[#070c0e] px-3 py-3.5"
          aria-live="polite"
        >
          {messages.slice(0, shown)}
          {sent && shown === CHAT_STEPS && (
            <div className={bot}>
              {lt("chat.paid")}
              <div className="mt-1.5">{file(lt("chat.fileName"))}</div>
            </div>
          )}
        </div>
        <div className="mt-3 grid gap-2">
          <div className="flex justify-between gap-2 px-1 text-xs text-muted">
            <span>{lt("seller.panel")}</span>
            <span>{lt(sent ? "seller.ready" : "seller.waiting")}</span>
          </div>
          <button
            type="button"
            aria-pressed={sent}
            disabled={shown < CHAT_STEPS}
            onClick={() => setSent((v) => !v)}
            className="night-press w-full rounded-[22px] bg-accent px-4 py-4 text-center text-accent-fg focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-fg"
          >
            <span className="block font-display text-2xl">
              {lt(sent ? "confirm.buttonDone" : "confirm.button")}
            </span>
            <span className="mt-1.5 block text-sm">{lt("confirm.buttonSub")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setReplay((n) => n + 1);
            }}
            className="justify-self-center px-2 py-1 text-[13px] text-muted underline underline-offset-4 hover:text-fg"
          >
            {lt("chat.replay")}
          </button>
        </div>
      </div>
    </div>
  );
}
