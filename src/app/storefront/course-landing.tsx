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
      box: "rounded-3xl bg-accent/10 px-6 py-10 md:px-12 md:py-16",
      sub: "text-muted",
      main: "btn-primary",
      alt: "btn-secondary",
    },
    bold: {
      box: "rounded-3xl bg-accent px-6 py-10 text-accent-fg md:px-12 md:py-16",
      sub: "opacity-90",
      main: "rounded-lg bg-accent-fg font-medium text-accent",
      alt: "rounded-lg border border-current font-medium",
    },
    minimal: {
      box: "border-b border-line pt-6 pb-12 md:pt-10 md:pb-16",
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
      <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-tight md:text-5xl">
        {l.headline || props.title}
      </h1>
      {l.subtitle && <p className={`mt-4 max-w-2xl text-base md:text-xl ${s.sub}`}>{l.subtitle}</p>}
      <div className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="text-3xl font-semibold">{props.price}</span>
        {props.lessons > 0 && (
          <span className={`text-base ${s.sub}`}>{t("landing.lessons", { n: props.lessons })}</span>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        {props.tgUrl && (
          <a
            href={props.tgUrl}
            target="_blank"
            rel="noreferrer"
            className={`${s.main} px-7 py-3.5 text-lg`}
          >
            {t("landing.buyTg")}
          </a>
        )}
        {props.onBuySite && (
          <button
            type="button"
            onClick={props.onBuySite}
            className={`${props.tgUrl ? s.alt : s.main} px-7 py-3.5 text-lg`}
          >
            {t("landing.buySite")}
          </button>
        )}
      </div>
      {props.freeLesson && <p className={`mt-5 text-base ${s.sub}`}>🔓 {t("landing.free")}</p>}
    </section>
  );
}

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mb-6 text-2xl font-semibold tracking-tight md:text-3xl">{children}</h2>
);

/** Блоки продавца по порядку; программа — из урока, её рисует страница товара. */
export function LandingBlocks(props: {
  landing: StoreLanding;
  program: ReactNode | null;
  onPhoto: (i: number) => void;
  /** Блоки идут первыми в колонке (нет фото) — у первого нет верхнего отступа. */
  first?: boolean;
  t: T;
}) {
  const { landing: l, t } = props;
  const blocks = visibleBlocks(l, { program: props.program != null });
  const gap = (b: LandingBlock) => (props.first && b === blocks[0] ? "" : "mt-14");
  const render: Record<LandingBlock, () => ReactNode> = {
    learn: () => (
      <section key="learn" className={gap("learn")} data-testid="landing-learn">
        <H2>{t("landing.learn")}</H2>
        <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {l.learn.map((x, i) => (
            <li key={i} className="flex gap-3 text-lg leading-snug">
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm text-accent"
                aria-hidden
              >
                ✓
              </span>
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </section>
    ),
    program: () => (
      <section key="program" className={gap("program")} data-testid="landing-program">
        <H2>{t("landing.program")}</H2>
        {props.program}
      </section>
    ),
    authors: () => (
      <section key="authors" className={gap("authors")} data-testid="landing-authors">
        <H2>{t("landing.authors")}</H2>
        <div className="grid gap-4 md:grid-cols-2">
          {l.authors.map((a, i) => (
            <div key={i} className="card flex gap-5 p-6">
              {a.photo ? (
                <img
                  src={a.photo}
                  alt={a.name}
                  loading="lazy"
                  className="h-24 w-24 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent/15 text-3xl font-semibold text-accent"
                  aria-hidden
                >
                  {a.name.slice(0, 1).toUpperCase() || "★"}
                </div>
              )}
              <div className="min-w-0 self-center">
                {a.name && <div className="text-xl font-semibold">{a.name}</div>}
                {a.text && (
                  <p className="mt-1.5 text-base leading-relaxed whitespace-pre-line text-muted">
                    {a.text}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    ),
    works: () => (
      <section key="works" className={gap("works")} data-testid="landing-works">
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
      <section key="quotes" className={gap("quotes")} data-testid="landing-quotes">
        <H2>{t("landing.quotes")}</H2>
        <div className="grid gap-3 md:grid-cols-2">
          {l.quotes.map((q, i) => (
            <blockquote key={i} className="card border-l-4 border-l-accent p-6 text-lg">
              <p className="whitespace-pre-line">«{q.text}»</p>
              {q.name && <footer className="mt-2 text-muted">— {q.name}</footer>}
            </blockquote>
          ))}
        </div>
      </section>
    ),
    faq: () => (
      <section key="faq" className={gap("faq")} data-testid="landing-faq">
        <H2>{t("landing.faq")}</H2>
        <div className="space-y-3">
          {l.faq.map((f, i) => (
            <details key={i} className="card p-6">
              <summary className="cursor-pointer text-lg font-medium">{f.q}</summary>
              <p className="mt-3 text-lg leading-relaxed whitespace-pre-line text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    ),
  };
  return <>{blocks.map((b) => render[b]())}</>;
}
