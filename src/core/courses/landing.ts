import { isTenantStorageKey } from "@/core/storage/keys";
import { moduleOf, shortTitle } from "./course-format";

/**
 * Страница курса на витрине (03.11.2026, первый пример — Lash Academy):
 * шаблон с простым конструктором. Блоки и их вид заданы заранее, продавец
 * заполняет их, включает нужные и меняет порядок; тема и цвет — на выбор.
 * Хранится отдельной записью `app_settings.course_landing_<товар>`, схема
 * базы не меняется. Нет записи или выключена — товар выглядит как раньше.
 */
export const LANDING_BLOCKS = ["learn", "program", "authors", "works", "quotes", "faq"] as const;
export type LandingBlock = (typeof LANDING_BLOCKS)[number];

export const LANDING_THEMES = ["soft", "bold", "minimal"] as const;
export type LandingTheme = (typeof LANDING_THEMES)[number];

export const LANDING_LIMITS = {
  headline: 120,
  subtitle: 300,
  authors: 3,
  authorName: 80,
  authorText: 600,
  learn: 12,
  learnItem: 200,
  works: 12,
  quotes: 10,
  quoteName: 80,
  quoteText: 600,
  faq: 15,
  faqQ: 200,
  faqA: 1000,
} as const;

export const ACCENT_RE = /^#[0-9a-f]{6}$/i;

export type LandingAuthor = { photo: string | null; name: string; text: string };
export type CourseLanding = {
  on: boolean;
  theme: LandingTheme;
  /** Цвет кнопок и акцентов страницы, `#rrggbb`; null — цвет витрины. */
  accent: string | null;
  headline: string;
  subtitle: string;
  /** Порядок блоков; каждый вид — ровно один раз. */
  order: LandingBlock[];
  hidden: LandingBlock[];
  authors: LandingAuthor[];
  learn: string[];
  /** Фото работ — ключи хранилища этого магазина. */
  works: string[];
  quotes: Array<{ name: string; text: string }>;
  faq: Array<{ q: string; a: string }>;
};

export const landingKey = (productId: string) => `course_landing_${productId}`;

export const emptyLanding = (): CourseLanding => ({
  on: false,
  theme: "soft",
  accent: null,
  headline: "",
  subtitle: "",
  order: [...LANDING_BLOCKS],
  hidden: [],
  authors: [],
  learn: [],
  works: [],
  quotes: [],
  faq: [],
});

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isBlock = (v: unknown): v is LandingBlock =>
  (LANDING_BLOCKS as readonly unknown[]).includes(v);

/** Порядок без повторов; недостающие виды — в конец, в исходном порядке. */
export function normalOrder(order: unknown): LandingBlock[] {
  const out: LandingBlock[] = [];
  for (const b of arr(order)) if (isBlock(b) && !out.includes(b)) out.push(b);
  for (const b of LANDING_BLOCKS) if (!out.includes(b)) out.push(b);
  return out;
}

/**
 * Разбор записи. Битая запись — пустая страница (выключена), а не ошибка:
 * витрина курса не должна падать из-за оформления. Фото с чужим префиксом
 * отбрасываются (путь из базы не доверенный, как в #89).
 */
export function parseLanding(raw: string | null, tenantId: string): CourseLanding {
  if (!raw) return emptyLanding();
  let v: Record<string, unknown>;
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return emptyLanding();
    v = p as Record<string, unknown>;
  } catch {
    return emptyLanding();
  }
  return cleanLanding(v, tenantId);
}

const L = LANDING_LIMITS;
const own = (tenantId: string) => (k: unknown) =>
  typeof k === "string" && isTenantStorageKey(tenantId, k);

/** Приводит присланное к форме записи: обрезает по пределам, выкидывает пустое и чужое. */
export function cleanLanding(v: Record<string, unknown>, tenantId: string): CourseLanding {
  const theme = (LANDING_THEMES as readonly unknown[]).includes(v.theme)
    ? (v.theme as LandingTheme)
    : "soft";
  const accent = typeof v.accent === "string" && ACCENT_RE.test(v.accent) ? v.accent : null;
  const mine = own(tenantId);
  return {
    on: v.on === true,
    theme,
    accent,
    headline: str(v.headline, L.headline),
    subtitle: str(v.subtitle, L.subtitle),
    order: normalOrder(v.order),
    hidden: [...new Set(arr(v.hidden).filter(isBlock))],
    authors: arr(v.authors)
      .map((a) => {
        const o = (a ?? {}) as Record<string, unknown>;
        return {
          photo: mine(o.photo) ? (o.photo as string) : null,
          name: str(o.name, L.authorName),
          text: str(o.text, L.authorText),
        };
      })
      .filter((a) => a.name || a.text || a.photo)
      .slice(0, L.authors),
    learn: arr(v.learn)
      .map((x) => str(x, L.learnItem))
      .filter(Boolean)
      .slice(0, L.learn),
    works: [...new Set(arr(v.works).filter(mine) as string[])].slice(0, L.works),
    quotes: arr(v.quotes)
      .map((q) => {
        const o = (q ?? {}) as Record<string, unknown>;
        return { name: str(o.name, L.quoteName), text: str(o.text, L.quoteText) };
      })
      .filter((q) => q.text)
      .slice(0, L.quotes),
    faq: arr(v.faq)
      .map((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        return { q: str(o.q, L.faqQ), a: str(o.a, L.faqA) };
      })
      .filter((f) => f.q && f.a)
      .slice(0, L.faq),
  };
}

/** Блоки, которые покупатель увидит: включённые и с содержимым, в порядке продавца. */
export function visibleBlocks(
  l: Pick<CourseLanding, "order" | "hidden" | "learn" | "faq" | "quotes"> & {
    authors: unknown[];
    works: unknown[];
  },
  has: { program: boolean },
): LandingBlock[] {
  const filled: Record<LandingBlock, boolean> = {
    learn: l.learn.length > 0,
    program: has.program,
    authors: l.authors.length > 0,
    works: l.works.length > 0,
    quotes: l.quotes.length > 0,
    faq: l.faq.length > 0,
  };
  return l.order.filter((b) => filled[b] && !l.hidden.includes(b));
}

/** Программа по модулям: «Модуль 1 · 1.1. …» → группа «Модуль 1»; без модулей — одна группа. */
export function programModules<T extends { no: number; title: string }>(
  lessons: T[],
): Array<{ title: string | null; lessons: Array<T & { short: string }> }> {
  const out: Array<{ title: string | null; lessons: Array<T & { short: string }> }> = [];
  for (const l of lessons) {
    const m = moduleOf(l.title);
    const last = out[out.length - 1];
    const item = { ...l, short: m ? shortTitle(l.title, l.no) : l.title };
    if (last && last.title === m) last.lessons.push(item);
    else out.push({ title: m, lessons: [item] });
  }
  return out;
}

/** Тексты черновика на языке продавца (из словаря админки). */
export type DraftTexts = {
  subtitle: (lessons: number, modules: number) => string;
  faqFormatQ: string;
  faqFormatA: (lessons: number) => string;
  faqHomeworkQ: string;
  faqHomeworkA: string;
  faqAccessQ: string;
  faqAccessA: (days: number | null) => string;
  faqFreeQ: string;
  faqFreeA: string;
};

/**
 * «Заполнить из курса»: черновик из того, что уже есть в курсе. Ничего не
 * выдумывает — подзаголовок из числа уроков и модулей, «Чему научитесь» из
 * названий уроков, вопросы — только о том, что действительно настроено
 * (ДЗ, срок доступа, открытый урок). Условия оплаты и доставки не пишет:
 * их продавец задаёт сам. Авторы, работы и отзывы остаются как были.
 */
export function draftFromCourse(
  prev: CourseLanding,
  input: {
    productName: string;
    lessons: Array<{ title: string; homework: boolean; preview: boolean }>;
    /** Срок доступа: null — бессрочно; undefined — у тарифов разный, вопрос не пишем. */
    accessDays?: number | null;
  },
  t: DraftTexts,
): CourseLanding {
  const lessons = input.lessons.map((l, i) => ({ ...l, no: i + 1 }));
  const modules = programModules(lessons).filter((m) => m.title).length;
  const learn = lessons
    .map((l) => shortTitle(l.title, l.no).replace(/^\d+(?:\.\d+)*\.?\s*/u, ""))
    .filter(Boolean)
    .slice(0, L.learn);
  const faq: CourseLanding["faq"] = [{ q: t.faqFormatQ, a: t.faqFormatA(lessons.length) }];
  if (lessons.some((l) => l.homework)) faq.push({ q: t.faqHomeworkQ, a: t.faqHomeworkA });
  if (input.accessDays !== undefined)
    faq.push({ q: t.faqAccessQ, a: t.faqAccessA(input.accessDays) });
  if (lessons.some((l) => l.preview)) faq.push({ q: t.faqFreeQ, a: t.faqFreeA });
  return {
    ...prev,
    on: true,
    headline: prev.headline || input.productName.slice(0, L.headline),
    subtitle: t.subtitle(lessons.length, modules).slice(0, L.subtitle),
    learn,
    faq,
  };
}
