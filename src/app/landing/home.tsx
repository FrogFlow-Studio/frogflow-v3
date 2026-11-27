/**
 * Главная `/` под брендом Enveriq (светлая тема `.theme-enveriq`): шапка,
 * первый экран с картинкой продукта, цифры и клиенты, как продаёт, возможности
 * плиткой, оплата и чек Kaspi, «один сервис вместо пяти» (тёмный блок), для
 * кого, тарифы, вопросы, призыв и подвал. Тарифы — общий блок из `./sections`
 * (тексты `i18n/landing`), остальные тексты — `i18n/home`. Ниши и статьи пока
 * остаются со старой шапкой FrogFlow.
 */
import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
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
import { openNichePages } from "./niches";
import { NicheLinks, langSearch } from "./sections";
import { delay } from "./motion";

export type HomeProps = { t: HomeT; lt: LandingT; locale: Locale; signup: boolean };

const LANG_LABELS: Record<Locale, string> = { ru: "RU", kk: "KZ", en: "EN", uz: "UZ" };
/** Ширина содержимого всех блоков главной. */
export const WRAP = "mx-auto w-full max-w-[1240px] px-4 md:px-6 xl:px-8";
const INK_BTN =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[var(--ink)] font-semibold text-white transition-colors hover:bg-[#262c29]";

/** Логотип Enveriq: `light` — для светлого фона, `dark` — для тёмного. */
export function BrandLogo({
  on = "light",
  byline = true,
}: {
  on?: "light" | "dark";
  byline?: boolean;
}) {
  const logo = on === "light" ? BRAND.logo : BRAND.logoOnDark;
  return (
    <span className="flex items-center gap-3">
      <img
        src={logo.src}
        alt={BRAND.name}
        width={logo.width}
        height={logo.height}
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

const Arrow = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
    <path
      d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Check = ({ className = "text-[var(--lime-ink)]" }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={`h-4 w-4 shrink-0 ${className}`} aria-hidden>
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

export function HomeHeader({ t, locale, signup }: HomeProps) {
  const links = (
    <>
      <a href="#how" className="text-muted hover:text-fg">
        {t("nav.how")}
      </a>
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
    <header className="sticky top-0 z-30 border-b border-line/80 bg-[rgb(247_248_244/0.85)] backdrop-blur-md">
      <div className={`${WRAP} flex items-center gap-6 py-3`}>
        <Link to="/" search={langSearch(locale)} aria-label={BRAND.name} className="shrink-0">
          <BrandLogo />
        </Link>
        <nav aria-label={t("nav.features")} className="hidden gap-6 text-sm font-medium lg:flex">
          {links}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div
            role="group"
            aria-label={t("nav.language")}
            className="flex overflow-hidden rounded-full border border-line bg-surface text-xs"
          >
            {SUPPORTED_LOCALES.map((l) => (
              <Link
                key={l}
                to="/"
                search={langSearch(l)}
                hrefLang={l}
                aria-current={l === locale ? "true" : undefined}
                className={`px-2.5 py-1.5 font-medium ${
                  l === locale ? "bg-[var(--ink)] text-white" : "text-muted hover:text-fg"
                }`}
              >
                {LANG_LABELS[l]}
              </Link>
            ))}
          </div>
          <Link to="/admin/login" className="text-sm font-semibold hover:text-[var(--lime-ink)]">
            {t("nav.login")}
          </Link>
          <span className="hidden md:block">
            <SignupLink locale={locale} signup={signup} className={`${INK_BTN} px-4 py-2 text-sm`}>
              {t("nav.cta")}
            </SignupLink>
          </span>
        </div>
      </div>
      <nav
        aria-label={t("nav.features")}
        className="flex gap-5 overflow-x-auto px-4 pb-2.5 text-sm font-medium whitespace-nowrap lg:hidden"
      >
        {links}
      </nav>
    </header>
  );
}

const WORKS_WITH: Array<{ name: string; color: string }> = [
  { name: "Instagram", color: "#e1306c" },
  { name: "Telegram", color: "#2a9bd8" },
  { name: "WhatsApp", color: "#25a55a" },
  { name: "Kaspi", color: "#f14635" },
  { name: "Робокасса", color: "#7b61ff" },
  { name: "Продамус", color: "#0d0f0e" },
];

/** Первый экран: обещание, кнопки и картинка продукта. `ctaRef` — для нижней кнопки на телефоне. */
export function Hero({ t, locale, signup, ctaRef }: HomeProps & { ctaRef: Ref<HTMLDivElement> }) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="enveriq-dots pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-10%] h-[620px] w-[620px] rounded-full bg-[radial-gradient(closest-side,rgb(140_207_46/0.35),transparent)] blur-2xl"
      />
      <div
        className={`${WRAP} relative grid items-center gap-12 pt-10 pb-12 md:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pt-20 lg:pb-20`}
      >
        <div className="min-w-0">
          <p className="ev-rise inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pr-3.5 pl-2 text-[13px] font-medium text-muted shadow-sm">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--lime)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ink)]" />
            </span>
            {t("hero.eyebrow")}
          </p>
          <h1
            style={delay(90)}
            className="ev-rise mt-6 font-display text-[42px] leading-[1] text-balance sm:text-[54px] md:text-[64px] xl:text-[76px]"
          >
            {t("hero.titleHead")}{" "}
            <span className="relative whitespace-nowrap">
              <span className="relative z-10">{t("hero.titleTail")}</span>
              <span
                aria-hidden
                className="ev-mark absolute inset-x-[-4px] bottom-[0.06em] z-0 h-[0.36em] -skew-x-12 rounded-sm bg-[var(--lime)]"
              />
            </span>
          </h1>
          <p
            style={delay(220)}
            className="ev-rise mt-6 max-w-xl text-[17px] leading-relaxed text-muted md:text-lg"
          >
            {t("hero.lead")}
          </p>
          <div
            ref={ctaRef}
            style={delay(320)}
            className="ev-rise mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap"
          >
            <SignupLink locale={locale} signup={signup} className="btn-primary px-7 py-4 text-base">
              {signup ? t("hero.ctaSignup", { days: TRIAL_DAYS }) : t("hero.ctaLogin")}
              <Arrow />
            </SignupLink>
            {DEMO_URL && (
              <a
                href={DEMO_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary px-7 py-4 text-base"
              >
                {t("hero.ctaDemo")}
              </a>
            )}
          </div>
          <ul
            style={delay(420)}
            className="ev-rise mt-6 grid gap-2 text-sm text-muted sm:flex sm:flex-wrap sm:gap-x-6"
          >
            {(["hero.r1", "hero.r2", "hero.r3"] as const).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <Check />
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <HeroVisual t={t} />
      </div>
      <div className={`${WRAP} relative pb-10`}>
        <div
          style={delay(520)}
          className="ev-rise flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-6"
        >
          <span className="text-xs font-semibold tracking-[0.18em] text-muted uppercase">
            {t("works.label")}
          </span>
          <ul className="flex flex-wrap gap-2">
            {WORKS_WITH.map((w, i) => (
              <li
                key={w.name}
                style={delay(700 + i * 70)}
                className="ev-pop flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: w.color }}
                  aria-hidden
                />
                {w.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Картинка продукта: переписка в Direct с ответом ИИ и карточка заказа из
 * панели продавца с кнопкой «Деньги пришли». Только показ, ничего не пишет.
 */
function HeroVisual({ t }: { t: HomeT }) {
  const [sent, setSent] = useState(false);
  return (
    <div className="relative mx-auto w-full max-w-[540px] pb-40 sm:pb-32 lg:mr-0">
      {/* Телефон с перепиской */}
      <div
        style={delay(150)}
        className="ev-rise relative mt-14 ml-auto w-[80%] max-w-[340px] rounded-[36px] border border-line bg-surface p-2.5 shadow-[0_30px_80px_-30px_rgb(13_15_14/0.35)] sm:w-[64%]"
      >
        <div className="rounded-[28px] bg-[var(--surface-2)] p-3">
          <div className="flex items-center gap-2.5 pb-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7)] p-[2px]">
              <span className="grid h-full w-full place-items-center rounded-full bg-surface text-xs font-bold">
                {t("chat.avatar")}
              </span>
            </span>
            <div className="min-w-0 text-[13px] leading-tight">
              <b className="block">azbuka.shop</b>
              <span className="text-muted">Instagram Direct</span>
            </div>
          </div>
          <div className="grid gap-2 text-[13.5px] leading-snug">
            <div
              style={delay(700)}
              className="ev-pop max-w-[85%] justify-self-end rounded-2xl rounded-br-md bg-[var(--ink)] px-3 py-2 text-white"
            >
              {t("feat.ai.q")}
            </div>
            <div className="grid">
              <div
                aria-hidden
                style={{ ...delay(1250), "--t": "1000ms" } as CSSProperties}
                className="ev-typing col-start-1 row-start-1 flex w-fit gap-1 self-start rounded-2xl rounded-bl-md bg-surface px-3.5 py-3 shadow-sm"
              >
                <i className="h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
                <i className="h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
                <i className="h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
              </div>
              <div
                style={delay(2250)}
                className="ev-pop col-start-1 row-start-1 max-w-[88%] rounded-2xl rounded-bl-md bg-surface px-3 py-2 shadow-sm"
              >
                {t("feat.ai.a")}
              </div>
            </div>
            <div
              style={delay(2750)}
              className="ev-pop flex max-w-[88%] items-center gap-3 rounded-2xl rounded-bl-md bg-surface p-2 shadow-sm"
            >
              <div className="h-14 w-14 shrink-0 rounded-xl bg-[repeating-linear-gradient(135deg,#eaf6d6_0_8px,#dff0c4_8px_16px)]" />
              <div className="min-w-0 pr-1">
                <div className="font-semibold">{t("vis.product")}</div>
                <div className="font-semibold text-[var(--lime-ink)] tabular-nums">1 900 ₸</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Чип: ответ ИИ */}
      <div style={delay(2400)} className="ev-pop absolute top-0 left-0">
        <div className="enveriq-float flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2 text-[13px] font-semibold shadow-[0_12px_30px_-12px_rgb(13_15_14/0.3)] ">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--lime)] text-[var(--ink)]">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3Z" />
            </svg>
          </span>
          {t("vis.ai")}
        </div>
      </div>
      {/* Карточка заказа в панели продавца */}
      <div
        style={delay(3200)}
        className="ev-pop absolute bottom-0 left-0 w-[78%] max-w-[300px] rounded-3xl border border-line bg-surface p-4 shadow-[0_24px_60px_-20px_rgb(13_15_14/0.35)] sm:w-[52%]"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span className="font-semibold">{t("vis.order")}</span>
          <span className="font-semibold text-fg tabular-nums">1 900 ₸</span>
        </div>
        <div
          style={delay(3700)}
          className="ev-pop mt-2 flex items-center gap-2 rounded-xl bg-[var(--lime-soft)] px-3 py-2 text-[13px] font-semibold text-[var(--lime-ink)]"
        >
          <Check />
          {t("vis.receipt")}
        </div>
        <p
          className={`mt-2 text-[13px] font-medium ${sent ? "text-[var(--lime-ink)]" : "text-muted"}`}
          aria-live="polite"
        >
          {t(sent ? "vis.done" : "vis.waiting")}
        </p>
        <button
          type="button"
          aria-pressed={sent}
          onClick={() => setSent((v) => !v)}
          style={delay(4200)}
          className={`mt-3 w-full rounded-2xl px-4 py-3 font-display text-lg transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)] ${
            sent
              ? "bg-[var(--ink)] text-white"
              : "ev-pulse bg-[var(--lime)] text-[var(--ink)] hover:bg-[#9bdb3d]"
          }`}
        >
          {sent ? `✓ ${t("vis.done")}` : t("vis.button")}
        </button>
      </div>
    </div>
  );
}

/** Подпись клиента без цифр (запуск недавний). */
const LAUNCH_LABEL: Record<Locale, string> = {
  ru: "Новый запуск",
  kk: "Жаңа іске қосу",
  en: "New launch",
  uz: "Yangi ishga tushirish",
};

/** Цифры платформы и клиенты с цифрами из базы; на телефоне клиенты — лента вбок. */
export function Proof({ t, locale }: HomeProps) {
  const stats: Array<[string, string]> = [
    [PLATFORM_ORDERS, t("proof.total")],
    ["4", t("stats.langs")],
    ["3", t("stats.channels")],
    [String(TRIAL_DAYS), t("stats.trial")],
  ];
  return (
    <section aria-labelledby="proof-title" className="border-y border-line bg-surface">
      <div className={`${WRAP} py-12 md:py-16`}>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
          {stats.map(([n, label], i) => (
            <li
              key={label}
              data-reveal
              style={delay(i * 90)}
              className="border-l-2 border-[var(--lime)] pl-4"
            >
              <span
                data-count={n}
                className="block font-display text-[40px] leading-none tabular-nums md:text-[52px]"
              >
                {n}
              </span>
              <span className="mt-2 block text-sm leading-snug text-muted">{label}</span>
            </li>
          ))}
        </ul>
        {CLIENTS.length > 0 && (
          <>
            <div data-reveal className="mt-14 flex flex-wrap items-end justify-between gap-3">
              <h2
                id="proof-title"
                className="font-display text-[26px] leading-tight md:text-[32px]"
              >
                {t("proof.title")}
              </h2>
              <p className="text-xs text-muted">{t("proof.asOf", { date: CLIENTS_AS_OF })}</p>
            </div>
            <ul className="-mx-4 mt-6 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-5">
              {CLIENTS.map((c, i) => {
                const [what, figures] = c.note[locale].split(" · ");
                return (
                  <li
                    key={c.name}
                    data-reveal
                    style={delay(i * 80)}
                    className="ev-card flex w-[74%] shrink-0 snap-start flex-col gap-1 rounded-3xl border border-line bg-[var(--bg)] p-5 sm:w-[44%] md:w-auto"
                  >
                    {c.stat ? (
                      <>
                        <span
                          data-count={c.stat.value}
                          className="font-display text-[30px] leading-none tabular-nums"
                        >
                          {c.stat.value}
                        </span>
                        <span className="text-sm text-muted">{c.stat.label[locale]}</span>
                      </>
                    ) : (
                      <span className="w-fit rounded-full bg-[var(--lime)] px-2.5 py-1 text-xs font-bold">
                        {LAUNCH_LABEL[locale]}
                      </span>
                    )}
                    <span className="mt-auto border-t border-line pt-3 font-semibold">
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-[var(--lime-ink)]"
                        >
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
          </>
        )}
      </div>
    </section>
  );
}

export function HomeTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div data-reveal className="max-w-3xl">
      <h2 className="font-display text-[32px] leading-[1.05] text-balance md:text-[48px]">
        {children}
      </h2>
      <span
        aria-hidden
        className="ev-underline mt-4 block h-1.5 w-16 -skew-x-12 rounded-sm bg-[var(--lime)]"
      />
      {sub && <p className="mt-4 text-[17px] leading-relaxed text-muted md:text-lg">{sub}</p>}
    </div>
  );
}

/** Как продаёт: четыре шага от сообщения до выданного товара. */
export function Flow({ t }: HomeProps) {
  return (
    <section id="how" className={`${WRAP} scroll-mt-28 py-16 md:py-24`}>
      <HomeTitle sub={t("flow.sub")}>{t("flow.title")}</HomeTitle>
      <ol className="relative mt-12 grid gap-6 md:grid-cols-4 md:gap-5">
        <span
          aria-hidden
          className="absolute top-6 right-[12%] left-[12%] hidden h-0.5 bg-[repeating-linear-gradient(90deg,var(--line)_0_8px,transparent_8px_14px)] md:block"
        />
        <span
          aria-hidden
          data-reveal="line"
          style={delay(200)}
          className="absolute top-[23px] right-[12%] left-[12%] hidden h-1 rounded-full bg-[var(--lime)] md:block"
        />
        {([1, 2, 3, 4] as const).map((n) => (
          <li
            key={n}
            data-reveal
            style={delay(150 + (n - 1) * 280)}
            className="relative flex gap-4 md:block"
          >
            <span
              className={`relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-2xl font-display text-xl ${
                n === 4 ? "bg-[var(--lime)] text-[var(--ink)]" : "bg-[var(--ink)] text-white"
              }`}
            >
              {n}
            </span>
            <div className="md:mt-5">
              <h3 className="text-lg font-semibold">{t(`flow.${n}.title` as HomeKey)}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                {t(`flow.${n}.text` as HomeKey)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const ICONS: Record<string, ReactNode> = {
  shop: <path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 7Zm4 0a4 4 0 0 1 8 0" />,
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
  langs: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </>
  ),
};

function Icon({ name }: { name: string }) {
  return (
    <span className="ev-icon grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--lime-soft)] text-[var(--lime-ink)]">
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
        {ICONS[name]}
      </svg>
    </span>
  );
}

const TILES = ["shop", "pay", "deliver", "site", "panel", "langs"] as const;
/** Что ещё умеет консультант — строки тарифов ниши «ИИ-консультант» (они же в карточках цен). */
const AI_LINES = ["pricing.ai.basic.f3", "pricing.ai.pro.f1", "pricing.ai.pro.f2"] as const;

/** Возможности плиткой: ИИ-консультант крупно, остальные шесть вокруг. */
export function Features({ t, lt }: HomeProps) {
  return (
    <section id="features" className="scroll-mt-28 border-y border-line bg-surface">
      <div className={`${WRAP} py-16 md:py-24`}>
        <HomeTitle sub={t("feat.sub")}>{t("feat.title")}</HomeTitle>
        <div className="mt-12 grid gap-3 md:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          <article
            data-reveal="scale"
            className="enveriq-ink relative isolate flex flex-col overflow-hidden rounded-3xl p-6 md:col-span-2 lg:row-span-3 lg:p-8"
          >
            <span
              aria-hidden
              className="ev-drift pointer-events-none absolute -top-24 -right-24 -z-10 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgb(140_207_46/0.28),transparent)]"
            />
            <span className="inline-flex w-fit items-center gap-2 self-start rounded-full bg-[var(--lime)] px-3 py-1 text-xs font-bold text-[var(--ink)]">
              AI
            </span>
            <h3 className="mt-4 font-display text-[28px] leading-tight md:text-[34px]">
              {t("feat.ai.title")}
            </h3>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
              {t("feat.ai.text")}
            </p>
            <ul className="mt-6 grid gap-2.5 text-[15px]">
              {AI_LINES.map((k) => (
                <li key={k} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--lime)] text-[var(--ink)]">
                    <Check className="text-[var(--ink)]" />
                  </span>
                  {lt(k)}
                </li>
              ))}
            </ul>
            <div
              className="mt-8 grid flex-1 content-center gap-2 rounded-2xl border border-[var(--ink-line)] bg-[#141816] p-4 text-[14px] leading-snug"
              aria-hidden
            >
              <p
                data-reveal
                style={delay(200)}
                className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              >
                {t("feat.ai.lblComment")}
              </p>
              <div data-reveal style={delay(550)} className="flex items-start gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold">
                  M
                </span>
                <div className="rounded-2xl rounded-tl-md bg-white/10 px-3 py-2">
                  {t("feat.ai.comment")}
                </div>
              </div>
              <div
                data-reveal
                style={delay(900)}
                className="ml-9 w-fit rounded-2xl rounded-tl-md border border-[var(--lime)]/40 px-3 py-2 text-[var(--lime)]"
              >
                {t("feat.ai.public")}
              </div>
              <p
                data-reveal
                style={delay(1250)}
                className="mt-3 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              >
                {t("feat.ai.lblDm")}
              </p>
              <div
                data-reveal
                style={delay(1600)}
                className="max-w-[90%] justify-self-start rounded-2xl rounded-bl-md bg-[#1f2522] px-3 py-2"
              >
                {t("feat.ai.dm")}
              </div>
              <div
                data-reveal
                style={delay(1950)}
                className="max-w-[85%] justify-self-end rounded-2xl rounded-br-md bg-white px-3 py-2 text-[var(--ink)]"
              >
                {t("feat.ai.yes")}
              </div>
            </div>
          </article>
          {TILES.map((f, i) => (
            <article
              key={f}
              data-reveal
              style={delay(120 + i * 70)}
              className="ev-card flex gap-4 rounded-3xl border border-line bg-[var(--bg)] p-5 md:block md:p-6"
            >
              <Icon name={f} />
              <div>
                <h3 className="text-lg font-semibold md:mt-4">{t(`feat.${f}.title` as HomeKey)}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                  {t(`feat.${f}.text` as HomeKey)}
                </p>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-5 text-sm text-muted">{t("feat.tiers")}</p>
      </div>
    </section>
  );
}

const CHECK_ROWS = ["r1", "r2", "r3", "r4", "r5"] as const;
const CHAT_PRICE = "1 900 ₸";

/** Оплата: два способа принимать деньги и что бот сверяет в чеке Kaspi. */
export function Payments({ t, lt }: HomeProps) {
  const tag = (n: number) => (
    <span
      className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-[var(--lime)] align-[1px] font-sans text-[11px] font-bold text-[var(--ink)]"
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
        data-reveal={own ? "right" : "left"}
        style={delay(own ? 120 : 0)}
        className={`ev-card flex flex-col gap-2 rounded-3xl p-6 md:p-7 ${
          own
            ? "border-2 border-[var(--lime)] bg-[linear-gradient(160deg,var(--lime-soft),var(--surface)_70%)]"
            : "border border-line bg-surface"
        }`}
      >
        <span className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
          {lt(`pay.${key}.when`)}
        </span>
        <h3 className="text-xl font-semibold">{lt(`pay.${key}.title`)}</h3>
        <p className="text-[15px] leading-relaxed text-muted">{lt(`pay.${key}.text`)}</p>
        <p className="mt-auto flex items-center gap-2.5 border-t border-dashed border-line pt-4 text-sm font-semibold">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${own ? "bg-[var(--lime)]" : "bg-[#e5a50a]"}`}
            aria-hidden
          />
          {lt(`pay.${key}.status`)}
        </p>
      </div>
    );
  };
  return (
    <section id="pay" className={`${WRAP} scroll-mt-28 py-16 md:py-24`}>
      <HomeTitle sub={t("pay.sub")}>{t("pay.title")}</HomeTitle>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {way("kaspi")}
        {way("own")}
      </div>
      <div
        data-reveal
        className="mt-6 grid items-start gap-8 rounded-3xl border border-line bg-surface p-6 md:grid-cols-[300px_1fr] md:gap-12 md:p-10"
      >
        <div
          data-reveal="scale"
          style={delay(200)}
          role="img"
          aria-label={lt("check.receipt.label")}
          className="night-receipt relative hidden w-full max-w-[300px] -rotate-2 rounded-md bg-[#f3f5ef] px-5 pt-5 pb-8 font-mono text-[13px] leading-[1.7] text-[#111614] tabular-nums shadow-[0_20px_40px_-20px_rgb(13_15_14/0.4)] md:block"
        >
          <span aria-hidden className="ev-scan" />
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
          <h3 className="font-display text-2xl leading-tight">{t("pay.checksTitle")}</h3>
          <ol className="mt-5 grid gap-x-8 border-t border-line sm:grid-cols-2">
            {CHECK_ROWS.map((r, i) => (
              <li
                key={r}
                data-reveal
                style={delay(300 + i * 120)}
                className="grid grid-cols-[28px_1fr] gap-3 border-b border-line py-4"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--ink)] text-xs font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <b className="block font-semibold">{lt(`check.${r}.what`)}</b>
                  <p className="mt-0.5 text-sm text-muted">{lt(`check.${r}.how`)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 grid grid-cols-[28px_1fr] gap-3 rounded-2xl border border-[#f0d9a8] bg-[#fff8e8] p-4">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[#e5a50a] text-xs font-bold text-[#1c1503]">
              !
            </span>
            <div>
              <b className="block font-semibold">{lt("check.r6.what")}</b>
              <p className="mt-0.5 text-sm text-[#5c4300]">{lt("check.r6.how")}</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted">{lt("pay.note")}</p>
        </div>
      </div>
    </section>
  );
}

/** «Один сервис вместо пяти» — тёмный блок; без названий конкурентов и чужих цен. */
export function Compare({ t, locale, signup }: HomeProps) {
  return (
    <section className="enveriq-ink">
      <div className={`${WRAP} py-16 md:py-24`}>
        <HomeTitle sub={t("compare.sub")}>{t("compare.title")}</HomeTitle>
        <div className="mt-12 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr] lg:gap-6">
          <div data-reveal="left" className="rounded-3xl border border-line bg-surface p-6 md:p-8">
            <h3 className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
              {t("compare.usual")}
            </h3>
            <ul className="mt-5 grid gap-2.5">
              {(["r1", "r2", "r3", "r4", "r5"] as const).map((r, i) => (
                <li
                  key={r}
                  className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-muted"
                >
                  <span aria-hidden className="text-lg leading-none text-[#e5675b]">
                    ×
                  </span>
                  <span className="ev-strike" style={delay(600 + i * 220)}>
                    {t(`compare.${r}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div aria-hidden className="hidden place-items-center lg:grid">
            <span
              data-reveal="scale"
              style={delay(1500)}
              className="ev-pulse grid h-14 w-14 place-items-center rounded-full bg-[var(--lime)] text-[var(--ink)]"
            >
              <Arrow />
            </span>
          </div>
          <div
            data-reveal="right"
            style={delay(1700)}
            className="relative isolate flex flex-col overflow-hidden rounded-3xl bg-[var(--lime)] p-6 text-[var(--ink)] md:p-8"
          >
            <span
              aria-hidden
              className="ev-drift pointer-events-none absolute -right-16 -bottom-20 -z-10 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.55),transparent)]"
            />
            <h3 className="text-xs font-bold tracking-[0.18em] uppercase">{t("compare.one")}</h3>
            <img
              src={BRAND.mark.src}
              alt=""
              width={BRAND.mark.width}
              height={BRAND.mark.height}
              className="mt-6 h-16 w-16 rounded-2xl"
            />
            <p className="mt-5 font-display text-[32px] leading-tight">{t("compare.oneTitle")}</p>
            <p className="mt-3 text-[17px] leading-relaxed">
              {t("compare.oneText", { price: formatTenge(PLAN_PRICES.basic) })}
            </p>
            <div className="mt-auto pt-8">
              <SignupLink
                locale={locale}
                signup={signup}
                className={`${INK_BTN} px-6 py-3.5 text-base`}
              >
                {t("nav.cta")}
                <Arrow />
              </SignupLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Для кого: карточки ниш со ссылками на их страницы. */
export function Segments({ t, lt, locale }: HomeProps) {
  const pages = openNichePages();
  if (pages.length === 0) return null;
  return (
    <section className={`${WRAP} py-16 md:py-24`}>
      <HomeTitle sub={t("seg.sub")}>{t("seg.title")}</HomeTitle>
      <nav
        aria-label={lt("niche.linksLabel")}
        className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
      >
        {pages.map((p, i) => (
          <Link
            key={p}
            to="/for/$niche"
            params={{ niche: p }}
            search={langSearch(locale)}
            data-reveal
            style={delay(i * 80)}
            className={`group ev-card ev-arrow flex flex-col rounded-3xl border border-line bg-surface p-6 ${pages.length === 5 && i < 2 ? "lg:col-span-3" : "lg:col-span-2"}`}
          >
            <span className="flex items-center justify-between gap-3 text-lg font-semibold">
              {lt(`niche.${p}.link` as LandingKey)}
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] transition-colors group-hover:bg-[var(--lime)]">
                <Arrow />
              </span>
            </span>
            <span className="mt-1.5 text-[15px] leading-relaxed text-muted">
              {t(`seg.${p}` as HomeKey)}
            </span>
          </Link>
        ))}
      </nav>
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
    <section id="faq" className={`${WRAP} scroll-mt-28 py-16 md:py-24`}>
      <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <h2 data-reveal className="font-display text-[32px] leading-[1.05] md:text-[48px]">
          {t("faq.title")}
        </h2>
        <div className="grid gap-3">
          {items.map(([q, a], i) => (
            <details
              key={q}
              data-reveal
              style={delay(i * 70)}
              className="ev-faq group rounded-2xl border border-line bg-surface px-5 open:shadow-sm"
              open={i === 0}
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-lg group-open:rotate-45 group-open:bg-[var(--lime)] motion-safe:transition-transform"
                >
                  +
                </span>
              </summary>
              <p className="pb-5 leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
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
      color: "#1b6fa0",
    },
    CONTACTS.whatsapp && {
      label: "WhatsApp",
      value: `+${CONTACTS.whatsapp}`,
      href: `https://wa.me/${CONTACTS.whatsapp}`,
      short: "WA",
      color: "#17703c",
    },
  ].filter(
    (c): c is { label: string; value: string; href: string; short: string; color: string } => !!c,
  );
  return (
    <section className={WRAP}>
      <div
        data-reveal="scale"
        className="relative overflow-hidden rounded-[36px] bg-[var(--lime)] px-6 py-10 text-[var(--ink)] md:px-12 md:py-16"
      >
        <div
          aria-hidden
          className="ev-drift pointer-events-none absolute -right-20 -bottom-24 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.5),transparent)]"
        />
        <div
          aria-hidden
          className="ev-drift pointer-events-none absolute -top-28 left-[30%] h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.3),transparent)] [animation-delay:-7s]"
        />
        <div
          className={`relative grid items-center gap-10 ${contacts.length ? "lg:grid-cols-[1.4fr_1fr]" : ""}`}
        >
          <div>
            <h2 className="font-display text-[34px] leading-[1.02] text-balance md:text-[54px]">
              {t("final.title")}
            </h2>
            <p className="mt-4 max-w-xl text-[17px] md:text-lg">
              {t("final.text", { days: TRIAL_DAYS })}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {signup && (
                <SignupLink
                  locale={locale}
                  signup={signup}
                  className={`${INK_BTN} px-7 py-4 text-base`}
                >
                  {t("final.cta")}
                  <Arrow />
                </SignupLink>
              )}
              <Link
                to="/admin/login"
                className="inline-flex items-center justify-center rounded-full border-2 border-[var(--ink)] px-7 py-3.5 text-base font-semibold hover:bg-white/30"
              >
                {t("final.login")}
              </Link>
            </div>
          </div>
          {contacts.length > 0 && (
            <div className="grid gap-3">
              <p className="text-sm font-medium">{t("final.contacts")}</p>
              {contacts.map((c, i) => (
                <a
                  data-reveal="right"
                  style={delay(300 + i * 120)}
                  key={c.label}
                  href={c.href}
                  target="_blank"
                  rel="noreferrer"
                  className="ev-card flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm"
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                    style={{ background: c.color }}
                    aria-hidden
                  >
                    {c.short}
                  </span>
                  <span>
                    <span className="block text-xs text-[#565e59]">{c.label}</span>
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
    <footer className="enveriq-ink mt-16 pb-24 md:pb-0">
      <div className={`${WRAP} grid gap-10 py-12 md:grid-cols-[1.3fr_1fr_1fr]`}>
        <div className="grid content-start gap-3">
          <BrandLogo on="dark" byline={false} />
          <a
            href={BRAND.studioUrl}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-sm text-muted hover:text-fg"
          >
            {BRAND.byline}
          </a>
          <p className="max-w-xs text-sm text-muted">{t("footer.tagline")}</p>
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
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[rgb(247_248_244/0.94)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-md transition-transform duration-200 md:hidden ${
        visible ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
    >
      <SignupLink locale={locale} signup={signup} className="btn-primary w-full py-3.5 text-base">
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
