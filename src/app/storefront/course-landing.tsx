import type { ReactNode } from "react";
import type { StoreLanding } from "@/core/courses/landing.server";
import { visibleBlocks, type LandingBlock } from "@/core/courses/landing";
import type { StorefrontKey } from "@/app/i18n/storefront";

type T = (key: StorefrontKey, vars?: Record<string, string | number>) => string;

/** Цвет страницы курса поверх цвета витрины (как `--accent` магазина в s.$slug). */
export function landingStyle(l: StoreLanding | null): React.CSSProperties | undefined {
  return l?.accent
    ? ({ "--accent": l.accent, "--accent-fg": "#ffffff" } as React.CSSProperties)
    : undefined;
}

const HERO: Record<StoreLanding["theme"], { box: string; sub: string; main: string; alt: string }> =
  {
    soft: {
      box: "rounded-2xl bg-accent/10 p-6 md:p-10",
      sub: "text-muted",
      main: "btn-primary",
      alt: "btn-secondary",
    },
    bold: {
      box: "rounded-2xl bg-accent p-6 text-accent-fg md:p-10",
      sub: "opacity-90",
      main: "rounded-lg bg-accent-fg font-medium text-accent",
      alt: "rounded-lg border border-current font-medium",
    },
    minimal: {
      box: "border-b border-line pb-8",
      sub: "text-muted",
      main: "btn-primary",
      alt: "btn-secondary",
    },
  };

/** Шапка страницы курса: заголовок, подзаголовок, цена и две кнопки покупки. */
export function LandingHero(props: {
  landing: StoreLanding;
  title: string;
  price: ReactNode;
  lessons: number;
  freeLesson: boolean;
  tgUrl: string | null;
  onBuySite: (() => void) | null;
  t: T;
}) {
  const { landing: l, t } = props;
  const s = HERO[l.theme];
  return (
    <section className={`mt-3 ${s.box}`} data-testid="course-landing-hero">
      <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
        {l.headline || props.title}
      </h1>
      {l.subtitle && <p className={`mt-3 text-base md:text-lg ${s.sub}`}>{l.subtitle}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-2xl font-semibold">{props.price}</span>
        {props.lessons > 0 && (
          <span className={`text-sm ${s.sub}`}>{t("landing.lessons", { n: props.lessons })}</span>
        )}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        {props.tgUrl && (
          <a
            href={props.tgUrl}
            target="_blank"
            rel="noreferrer"
            className={`${s.main} px-5 py-2.5 text-base`}
          >
            {t("landing.buyTg")}
          </a>
        )}
        {props.onBuySite && (
          <button
            type="button"
            onClick={props.onBuySite}
            className={`${props.tgUrl ? s.alt : s.main} px-5 py-2.5 text-base`}
          >
            {t("landing.buySite")}
          </button>
        )}
      </div>
      {props.freeLesson && <p className={`mt-3 text-sm ${s.sub}`}>🔓 {t("landing.free")}</p>}
    </section>
  );
}

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mb-4 text-xl font-semibold">{children}</h2>
);

/** Блоки продавца по порядку; программа — из урока, её рисует страница товара. */
export function LandingBlocks(props: {
  landing: StoreLanding;
  program: ReactNode | null;
  onPhoto: (i: number) => void;
  t: T;
}) {
  const { landing: l, t } = props;
  const blocks = visibleBlocks(l, { program: props.program != null });
  const render: Record<LandingBlock, () => ReactNode> = {
    learn: () => (
      <section key="learn" className="mt-10" data-testid="landing-learn">
        <H2>{t("landing.learn")}</H2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {l.learn.map((x, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="text-accent" aria-hidden>
                ✓
              </span>
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </section>
    ),
    program: () => (
      <section key="program" className="mt-10" data-testid="landing-program">
        <H2>{t("landing.program")}</H2>
        {props.program}
      </section>
    ),
    authors: () => (
      <section key="authors" className="mt-10" data-testid="landing-authors">
        <H2>{t("landing.authors")}</H2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {l.authors.map((a, i) => (
            <div key={i} className="card p-4">
              {a.photo ? (
                <img
                  src={a.photo}
                  alt={a.name}
                  loading="lazy"
                  className="mb-3 aspect-square w-full rounded-lg object-cover"
                />
              ) : (
                <div
                  className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-2xl font-semibold text-accent"
                  aria-hidden
                >
                  {a.name.slice(0, 1).toUpperCase() || "★"}
                </div>
              )}
              {a.name && <div className="font-semibold">{a.name}</div>}
              {a.text && <p className="mt-1 text-sm whitespace-pre-line text-muted">{a.text}</p>}
            </div>
          ))}
        </div>
      </section>
    ),
    works: () => (
      <section key="works" className="mt-10" data-testid="landing-works">
        <H2>{t("landing.works")}</H2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {l.works.map((src, i) => (
            <button
              key={src}
              type="button"
              className="cursor-zoom-in"
              onClick={() => props.onPhoto(i)}
              aria-label={t("viewer.open")}
            >
              <img
                src={src}
                alt=""
                loading="lazy"
                className="aspect-square w-full rounded-lg object-cover"
              />
            </button>
          ))}
        </div>
      </section>
    ),
    quotes: () => (
      <section key="quotes" className="mt-10" data-testid="landing-quotes">
        <H2>{t("landing.quotes")}</H2>
        <div className="grid gap-3 md:grid-cols-2">
          {l.quotes.map((q, i) => (
            <blockquote key={i} className="card border-l-4 border-l-accent p-4 text-sm">
              <p className="whitespace-pre-line">«{q.text}»</p>
              {q.name && <footer className="mt-2 text-muted">— {q.name}</footer>}
            </blockquote>
          ))}
        </div>
      </section>
    ),
    faq: () => (
      <section key="faq" className="mt-10" data-testid="landing-faq">
        <H2>{t("landing.faq")}</H2>
        <div className="space-y-2">
          {l.faq.map((f, i) => (
            <details key={i} className="card p-4">
              <summary className="cursor-pointer font-medium">{f.q}</summary>
              <p className="mt-2 text-sm whitespace-pre-line text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    ),
  };
  return <>{blocks.map((b) => render[b]())}</>;
}
