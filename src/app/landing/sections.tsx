/**
 * Общие блоки главной `/` и страниц ниш `/for/<ниша>`: шапка, три шага,
 * тарифы, вопросы, призыв и подвал. Тексты — `src/app/i18n/landing.ts`,
 * цены — `./config` (реестр планов).
 */
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import type { LandingKey, LandingT } from "@/app/i18n/landing";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { CALC_CHANNELS, calculate, type CalcChannel } from "@/core/plans/calculator";
import {
  ADDONS,
  ADDON_MONTHLY_PRICE,
  TIER_TITLES,
  TRIAL_TIER,
  addonForNiche,
  tierLimits,
} from "@/core/plans/registry";
import {
  CONTACTS,
  FEATURED_PLAN,
  PLAN_NICHE,
  PLAN_PRICES,
  ADDON_PRICE,
  ANNUAL_FREE_MONTHS,
  SETUP_FEES,
  TRIAL_DAYS,
  formatTenge,
  planFeatureKeys,
  type PlanKey,
  type PricingNiche,
} from "./config";
import { ARTICLES, ARTICLE_SLUGS, type ArticleSlug } from "./articles";
import { NICHE_VERTICAL, openNichePages, type NichePage } from "./niches";

/** Параметры ссылки на регистрацию: со страницы ниши — её ниша и откуда пришли. */
export const signupSearch = (niche?: NichePage) =>
  niche ? { vertical: NICHE_VERTICAL[niche], from: niche } : {};

const LANG_LABELS: Record<Locale, string> = { ru: "RU", kk: "KZ", en: "EN", uz: "UZ" };
const PLANS: PlanKey[] = ["basic", "pro", "business"];

/** Параметр языка в адресе: русский — без него. */
export const langSearch = (l: Locale) => ({ lang: l === "ru" ? undefined : l });

/** Шрифты публичных страниц: Exo 2 (как в логотипе) для заголовков, Onest для текста. */
export const LANDING_FONT_LINKS = [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" as const },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@1,800;1,900&family=Onest:wght@400;500;600;700&display=swap",
  },
];

/** Знак FrogFlow: лягушка с иконки студии. */
export function FrogMark({ className = "" }: { className?: string }) {
  return (
    <img
      src="/brand/frog-mark.webp"
      alt=""
      width={240}
      height={191}
      className={`aspect-[240/191] shrink-0 object-cover ${className}`}
    />
  );
}

/** Подпись «FrogFlow» как на логотипе: Flow лаймом. */
export function Wordmark() {
  return (
    <span className="font-display">
      Frog<span className="text-accent">Flow</span>
    </span>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-2xl leading-tight font-bold text-balance md:text-[32px]">
      {children}
    </h2>
  );
}

/** Шапка; на странице ниши переключатель языка остаётся на ней же. */
export function Header({
  t,
  locale,
  niche,
  article,
}: {
  t: LandingT;
  locale: Locale;
  niche?: NichePage;
  article?: ArticleSlug;
}) {
  // На статье якорей главной нет: ссылки ведут на главную.
  const anchorBase = article ? "/" : "";
  const links = (
    <>
      <a href={`${anchorBase}#how`} className="text-muted hover:text-fg">
        {t("nav.how")}
      </a>
      <a href={`${anchorBase}#pricing`} className="text-muted hover:text-fg">
        {t("nav.pricing")}
      </a>
      <a href={`${anchorBase}#faq`} className="text-muted hover:text-fg">
        {t("nav.faq")}
      </a>
    </>
  );
  const langClass = (l: Locale) =>
    `px-2 py-1.5 font-medium ${l === locale ? "bg-accent/15 text-fg" : "text-muted hover:text-fg"}`;
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1440px] items-center gap-6 px-4 xl:px-8 py-3">
        <Link
          to="/"
          search={langSearch(locale)}
          aria-label="FrogFlow"
          className="flex items-center gap-2.5 text-xl"
        >
          <FrogMark className="w-11 rounded-[10px]" />
          <Wordmark />
        </Link>
        <nav className="hidden gap-5 text-sm md:flex">{links}</nav>
        <div className="ml-auto flex items-center gap-3">
          <div
            role="group"
            aria-label={t("nav.language")}
            className="flex overflow-hidden rounded-md border border-line text-xs"
          >
            {SUPPORTED_LOCALES.map((l) =>
              article ? (
                <Link
                  key={l}
                  to="/blog/$slug"
                  params={{ slug: article }}
                  search={langSearch(l)}
                  hrefLang={l}
                  aria-current={l === locale ? "true" : undefined}
                  className={langClass(l)}
                >
                  {LANG_LABELS[l]}
                </Link>
              ) : niche ? (
                <Link
                  key={l}
                  to="/for/$niche"
                  params={{ niche }}
                  search={langSearch(l)}
                  hrefLang={l}
                  aria-current={l === locale ? "true" : undefined}
                  className={langClass(l)}
                >
                  {LANG_LABELS[l]}
                </Link>
              ) : (
                <Link
                  key={l}
                  to="/"
                  search={langSearch(l)}
                  hrefLang={l}
                  aria-current={l === locale ? "true" : undefined}
                  className={langClass(l)}
                >
                  {LANG_LABELS[l]}
                </Link>
              ),
            )}
          </div>
          <Link to="/admin/login" className="text-sm font-semibold hover:text-accent">
            {t("nav.login")}
          </Link>
        </div>
      </div>
      <nav className="flex gap-5 overflow-x-auto px-4 pb-3 text-sm whitespace-nowrap md:hidden">
        {links}
      </nav>
    </header>
  );
}

export function Steps({ t }: { t: LandingT }) {
  return (
    <section id="how" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="mx-auto w-full max-w-[1440px] px-4 xl:px-8 py-16">
        <SectionTitle>{t("steps.title")}</SectionTitle>
        <ol className="mt-9 grid gap-0.5 overflow-hidden rounded-3xl bg-line md:grid-cols-3">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="grid content-start gap-2 bg-bg p-7">
              <span className="font-display text-4xl leading-none font-bold text-accent">{n}</span>
              <span className="text-sm font-semibold text-accent">
                {t(`steps.${n}.time` as LandingKey)}
              </span>
              <h3 className="font-display text-xl leading-tight">
                {t(`steps.${n}.title` as LandingKey)}
              </h3>
              <p className="text-sm text-muted">{t(`steps.${n}.text` as LandingKey)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const CHANNEL_LABEL: Record<CalcChannel, LandingKey> = {
  telegram: "calc.telegram",
  instagram: "calc.instagram",
  whatsapp: "calc.whatsapp",
};

/** Калькулятор тарифа: только расчёт по реестру и кнопка регистрации, ничего не пишет. */
function TariffCalculator({
  t,
  signup,
  niche,
  page,
}: {
  t: LandingT;
  signup: boolean;
  niche: PricingNiche;
  page?: NichePage;
}) {
  const [channels, setChannels] = useState<CalcChannel[]>(["telegram"]);
  const [annual, setAnnual] = useState(false);
  const { quotes, recommended } = calculate(PLAN_NICHE[niche], channels, annual);
  const best = quotes.find((q) => q.tier === recommended)!;
  const names = (keys: string[]) =>
    keys.map((k) => ADDONS[k as keyof typeof ADDONS].title).join(", ");
  const toggle = (c: CalcChannel) =>
    setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  return (
    <div className="mt-8 rounded-2xl border border-line bg-surface p-6" data-testid="tariff-calc">
      <h3 className="font-display text-xl font-bold">{t("calc.title")}</h3>
      <p className="mt-1 text-sm text-muted">{t("calc.sub")}</p>
      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">{t("calc.channels")}</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {CALC_CHANNELS.map((c) => (
            <label
              key={c}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={channels.includes(c)}
                disabled={c === "telegram"}
                onChange={() => toggle(c)}
              />
              {t(CHANNEL_LABEL[c])}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={annual} onChange={() => setAnnual((v) => !v)} />
        {t("calc.annual", { free: ANNUAL_FREE_MONTHS })}
      </label>
      <div className="mt-5 grid gap-1" aria-live="polite">
        <div className="font-display text-2xl font-bold">
          {t("calc.reco", { tier: TIER_TITLES[best.tier] })}
        </div>
        <div className="text-lg font-semibold tabular-nums">
          {t(annual ? "calc.perMonthYear" : "calc.perMonth", { price: formatTenge(best.perMonth) })}
        </div>
        {annual && (
          <div className="text-sm text-muted tabular-nums">
            {t("calc.year", {
              price: formatTenge(best.yearTotal),
              saving: formatTenge(best.yearSaving),
            })}
          </div>
        )}
        <div className="text-sm text-muted tabular-nums">
          {t("calc.setup", { price: formatTenge(best.connection) })}
        </div>
        {best.included.length > 0 && (
          <div className="text-sm text-muted">
            {t("calc.included", { list: names(best.included) })}
          </div>
        )}
        {best.extra.length > 0 && (
          <div className="text-sm text-muted tabular-nums">
            {t("calc.extras", { list: names(best.extra), price: formatTenge(ADDON_PRICE) })}
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="text-sm font-semibold">{t("calc.all")}</div>
        <ul className="mt-1 grid gap-1 text-sm text-muted tabular-nums">
          {quotes.map((q) => (
            <li key={q.tier}>
              {TIER_TITLES[q.tier]}: {t("calc.perMonth", { price: formatTenge(q.perMonth) })}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-5">
        {signup ? (
          <Link to="/signup" search={signupSearch(page)} className="btn-primary px-5 py-2.5">
            {t("calc.cta")}
          </Link>
        ) : (
          <Link to="/admin/login" className="btn-primary px-5 py-2.5">
            {t("calc.cta")}
          </Link>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">{t("calc.note")}</p>
    </div>
  );
}

const PRICING_NICHES: PricingNiche[] = ["dig", "cake", "flow", "ai"];

/** Лимиты тарифа строками карточки — из реестра, не из текста. ИИ, не входящий в тариф, не пишем. */
function limitLines(t: LandingT, niche: PricingNiche, plan: PlanKey): string[] {
  const l = tierLimits(PLAN_NICHE[niche], plan);
  const out = [
    l.receiptChecks === null
      ? t("pricing.limit.receiptsUnlimited")
      : t("pricing.limit.receipts", { n: l.receiptChecks.toLocaleString("ru-RU") }),
  ];
  if (l.aiDialogs === null || l.aiDialogs > 0)
    out.push(t("pricing.limit.ai", { n: l.aiDialogs === null ? "∞" : String(l.aiDialogs) }));
  return out;
}

/** Тарифы; с `niche` — только этой ниши, без вкладок. */
export function Pricing({
  t,
  signup,
  niche: fixed,
  page,
}: {
  t: LandingT;
  signup: boolean;
  niche?: PricingNiche;
  /** Страница ниши: регистрация откроется с её нишей. */
  page?: NichePage;
}) {
  const [picked, setNiche] = useState<PricingNiche>("dig");
  const niche = fixed ?? picked;
  return (
    <section id="pricing" className="mx-auto w-full max-w-[1440px] scroll-mt-20 px-4 xl:px-8 py-16">
      <SectionTitle>{t("pricing.title")}</SectionTitle>
      <p className="mt-2 max-w-2xl text-muted">
        {t("pricing.sub", { days: TRIAL_DAYS, tier: TIER_TITLES[TRIAL_TIER] })}
      </p>
      {!fixed && (
        <div
          role="tablist"
          aria-label={t("pricing.nicheLabel")}
          className="mt-6 flex flex-wrap gap-2"
        >
          {PRICING_NICHES.map((n) => (
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
              {t(`pricing.niche.${n}` as LandingKey)}
            </button>
          ))}
        </div>
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const featured = p === FEATURED_PLAN;
          return (
            <div
              key={p}
              className={`flex flex-col rounded-2xl bg-surface p-6 ${
                featured ? "border-2 border-accent" : "border border-line"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-bold">
                  {p === "basic" ? "Basic" : p === "pro" ? "Pro" : "Business"}
                </h3>
                {featured && (
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-fg">
                    {t("pricing.featured")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">{t(`pricing.${p}.for` as LandingKey)}</p>
              <div className="mt-4 font-display text-3xl font-bold tabular-nums">
                {t("pricing.from", { price: formatTenge(PLAN_PRICES[p]) })}
              </div>
              <div className="text-sm text-muted">{t("pricing.perMonth")}</div>
              <div className="mt-1 text-sm text-muted tabular-nums">
                {t("pricing.setup", { price: formatTenge(SETUP_FEES[p]) })}
              </div>
              <ul className="mt-5 mb-6 grid gap-2 text-sm">
                {planFeatureKeys(niche, p).map((k) => (
                  <li key={k}>
                    <span className="font-bold text-accent">✓</span> {t(k)}
                  </li>
                ))}
                {limitLines(t, niche, p).map((line) => (
                  <li key={line} className="text-muted">
                    <span className="font-bold text-accent">✓</span> {line}
                  </li>
                ))}
              </ul>
              {signup ? (
                <Link
                  to="/signup"
                  search={signupSearch(page)}
                  className={`mt-auto ${featured ? "btn-primary" : "btn-secondary"} py-2.5`}
                >
                  {t("pricing.cta")}
                </Link>
              ) : (
                <Link
                  to="/admin/login"
                  className={`mt-auto ${featured ? "btn-primary" : "btn-secondary"} py-2.5`}
                >
                  {t("pricing.cta")}
                </Link>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted">
        {ANNUAL_FREE_MONTHS > 0 && <>{t("pricing.annual", { free: ANNUAL_FREE_MONTHS })} </>}
        {t("pricing.addon", { price: formatTenge(ADDON_PRICE) })}{" "}
        {addonForNiche("vip", PLAN_NICHE[niche]) && (
          <>
            {t("pricing.vipAddon", {
              price: formatTenge(PLAN_PRICES.basic + ADDON_MONTHLY_PRICE.vip),
            })}{" "}
          </>
        )}
        {t("pricing.aiPack", {
          n: ADDONS.ai_pack.aiDialogs,
          price: formatTenge(ADDON_MONTHLY_PRICE.ai_pack),
        })}
      </p>
      <TariffCalculator t={t} signup={signup} niche={niche} page={page} />
    </section>
  );
}

export function Faq({ t }: { t: LandingT }) {
  return (
    <section id="faq" className="mx-auto w-full max-w-3xl scroll-mt-20 px-4 py-16">
      <SectionTitle>{t("faq.title")}</SectionTitle>
      <div className="mt-6 border-b border-line">
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <details key={n} className="group border-t border-line" open={n === 1}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden">
              {t(`faq.${n}.q` as LandingKey)}
              <span className="text-xl text-muted group-open:rotate-45 motion-safe:transition-transform">
                +
              </span>
            </summary>
            <p className="pb-4 text-muted">{t(`faq.${n}.a` as LandingKey)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function FinalCta({ t, signup, page }: { t: LandingT; signup: boolean; page?: NichePage }) {
  const contacts = [
    CONTACTS.telegram && {
      label: "Telegram",
      value: `@${CONTACTS.telegram}`,
      href: `https://t.me/${CONTACTS.telegram}`,
      color: "#2a9bd8",
    },
    CONTACTS.whatsapp && {
      label: "WhatsApp",
      value: `+${CONTACTS.whatsapp}`,
      href: `https://wa.me/${CONTACTS.whatsapp}`,
      color: "#25a55a",
    },
  ].filter((c): c is { label: string; value: string; href: string; color: string } => !!c);
  return (
    <section className="mx-auto w-full max-w-[1440px] px-4 xl:px-8">
      <div
        className={`grid items-center gap-8 rounded-[30px] border border-line bg-[radial-gradient(120%_140%_at_0%_0%,var(--night-moss,var(--surface))_0%,var(--bg)_62%)] px-6 py-10 md:px-12 ${
          contacts.length > 0 ? "md:grid-cols-[auto_1.2fr_1fr]" : "md:grid-cols-[auto_1fr]"
        }`}
      >
        <FrogMark className="hidden w-28 rounded-3xl md:block" />
        <div>
          <h2 className="font-display text-3xl leading-tight font-bold md:text-[40px]">
            {t("final.title")}
          </h2>
          <p className="mt-3 max-w-xl text-muted">
            {t("final.text")} {contacts.length > 0 && t("final.textContacts")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {signup && (
              <Link
                to="/signup"
                search={signupSearch(page)}
                className="btn-primary px-5 py-2.5 text-base"
              >
                {t("final.cta")}
              </Link>
            )}
            <Link to="/admin/login" className="btn-secondary px-5 py-2.5 text-base">
              {t("final.login")}
            </Link>
          </div>
        </div>
        {contacts.length > 0 && (
          <div className="grid gap-3">
            {contacts.map((c) => (
              <a
                key={c.label}
                href={c.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-accent"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                  style={{ background: c.color }}
                >
                  {c.label === "Telegram" ? "TG" : "WA"}
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
    </section>
  );
}

/** Ссылки на страницы ниш; текущая (`except`) не повторяется. */
export function NicheLinks({
  t,
  locale,
  except,
  className,
}: {
  t: LandingT;
  locale: Locale;
  except?: NichePage;
  className?: string;
}) {
  const pages = openNichePages().filter((p) => p !== except);
  if (pages.length === 0) return null;
  return (
    <nav aria-label={t("niche.linksLabel")} className={className}>
      {pages.map((p) => (
        <Link
          key={p}
          to="/for/$niche"
          params={{ niche: p }}
          search={langSearch(locale)}
          className="hover:text-fg"
        >
          {t(`niche.${p}.link` as LandingKey)}
        </Link>
      ))}
    </nav>
  );
}

export function Footer({ t, locale, article }: { t: LandingT; locale: Locale; article?: boolean }) {
  const anchorBase = article ? "/" : "";
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 xl:px-8 py-6 text-sm text-muted">
        <span className="flex items-center gap-2.5">
          <FrogMark className="w-9 rounded-lg" />
          <span>
            © <Wordmark /> · {t("footer.tagline")}
          </span>
        </span>
        <NicheLinks t={t} locale={locale} className="flex flex-wrap gap-x-5 gap-y-2" />
        <nav aria-label={t("articles.linksLabel")} className="flex flex-wrap gap-x-5 gap-y-2">
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
        <span className="flex gap-5">
          <a href={`${anchorBase}#pricing`} className="hover:text-fg">
            {t("nav.pricing")}
          </a>
          <a href={`${anchorBase}#faq`} className="hover:text-fg">
            {t("nav.faq")}
          </a>
          <Link to="/admin/login" className="hover:text-fg">
            {t("footer.login")}
          </Link>
        </span>
      </div>
    </footer>
  );
}
