import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/**
 * База знаний «Помощь»: статьи — файлы `docs/help/<slug>.<язык>.md` (таблицы
 * нет). Первая строка — `# Заголовок`, вторая — `keywords: слово, синоним, …`
 * (по ним находят, когда в тексте статьи нужного слова нет), дальше тело:
 * абзацы, нумерованные списки и ссылки `[текст](/admin/…)`. У каждой статьи
 * обязаны быть все четыре языка — это проверяет тест.
 */
const RAW = import.meta.glob("../../../docs/help/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type HelpArticle = {
  slug: string;
  locale: Locale;
  title: string;
  keywords: string[];
  body: string;
};

export function parseArticle(slug: string, locale: Locale, raw: string): HelpArticle {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const title = /^#\s+(.+)$/.exec(lines[0] ?? "")?.[1]?.trim() ?? slug;
  // Prettier может вставить пустую строку между заголовком и «keywords:» — ищем в первых строках.
  const at = lines.slice(1, 4).findIndex((l) => /^keywords:/i.test(l)) + 1;
  const keywords =
    at > 0
      ? lines[at]!.replace(/^keywords:\s*/i, "")
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
      : [];
  const body = lines
    .slice(1)
    .filter((_, i) => i + 1 !== at)
    .join("\n")
    .trim();
  return { slug, locale, title, keywords, body };
}

function loadAll(): HelpArticle[] {
  const out: HelpArticle[] = [];
  for (const [path, raw] of Object.entries(RAW)) {
    const m = /\/([a-z0-9-]+)\.(ru|kk|en|uz)\.md$/.exec(path);
    if (m) out.push(parseArticle(m[1]!, m[2] as Locale, raw));
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug) || a.locale.localeCompare(b.locale));
}

export const HELP_ARTICLES: readonly HelpArticle[] = loadAll();

export const helpSlugs = (): string[] => [...new Set(HELP_ARTICLES.map((a) => a.slug))];

/** Статья на языке продавца; нет — русская (источник), нет и её — null. */
export function helpArticle(slug: string, locale: Locale): HelpArticle | null {
  const all = HELP_ARTICLES.filter((a) => a.slug === slug);
  return all.find((a) => a.locale === locale) ?? all.find((a) => a.locale === "ru") ?? null;
}

export function helpList(locale: Locale): HelpArticle[] {
  return helpSlugs()
    .map((s) => helpArticle(s, locale))
    .filter((a): a is HelpArticle => a !== null);
}

export const LOCALES_REQUIRED: readonly Locale[] = SUPPORTED_LOCALES;

/* ---------- поиск ---------- */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[’'ʻ‘`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");

/** Слова запроса: короче трёх знаков и служебные не ищем. */
export function queryWords(q: string): string[] {
  return [
    ...new Set(
      norm(q)
        .split(/\s+/)
        .filter((w) => w.length >= 3),
    ),
  ];
}

/** Слово запроса «совпало» со словом текста: общее начало (грубая основа слова: «подключить» ~ «подключение»). */
function sameStem(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length);
  if (n < 3) return false;
  const stem = Math.max(4, Math.ceil(Math.max(a.length, b.length) * 0.6));
  const k = Math.min(stem, n);
  return a.slice(0, k) === b.slice(0, k);
}

/** Оценка статьи по запросу: ключевые слова весомее заголовка, заголовок весомее тела. */
export function scoreArticle(a: HelpArticle, words: string[]): number {
  if (!words.length) return 0;
  const kw = norm(a.keywords.join(" ")).split(/\s+/).filter(Boolean);
  const title = norm(a.title).split(/\s+/).filter(Boolean);
  const body = norm(a.body).split(/\s+/).filter(Boolean);
  let score = 0;
  for (const w of words) {
    if (kw.some((k) => sameStem(w, k))) score += 3;
    if (title.some((t) => sameStem(w, t))) score += 2;
    if (body.some((t) => sameStem(w, t))) score += 1;
  }
  return score;
}

/** Статьи по запросу на языке продавца, лучшие первыми; пустой запрос — все. */
export function searchHelp(query: string, locale: Locale): HelpArticle[] {
  const words = queryWords(query);
  if (!words.length) return helpList(locale);
  return helpList(locale)
    .map((a) => ({ a, s: scoreArticle(a, words) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.slug.localeCompare(y.a.slug))
    .map((x) => x.a);
}

/**
 * «Возможно, вам поможет»: до трёх статей по тексту вопроса. Берём только
 * уверенные совпадения (не меньше двух баллов), чтобы не предлагать случайное.
 */
export function suggestHelp(text: string, locale: Locale, max = 3): HelpArticle[] {
  const words = queryWords(text);
  if (!words.length) return [];
  return helpList(locale)
    .map((a) => ({ a, s: scoreArticle(a, words) }))
    .filter((x) => x.s >= 2)
    .sort((x, y) => y.s - x.s || x.a.slug.localeCompare(y.a.slug))
    .slice(0, max)
    .map((x) => x.a);
}

/* ---------- простая разметка тела ---------- */

export type HelpBlock = { type: "p"; parts: HelpPart[] } | { type: "ol"; items: HelpPart[][] };
export type HelpPart = { text: string; href?: string };

/** `[текст](/путь)` → части; ссылки только внутренние (начинаются с «/»). */
export function parseInline(s: string): HelpPart[] {
  const out: HelpPart[] = [];
  let last = 0;
  for (const m of s.matchAll(/\[([^\]]+)\]\((\/[^)\s]*)\)/g)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[1]!, href: m[2]! });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

export function parseBody(body: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\d+\.\s/.test(l)))
      blocks.push({ type: "ol", items: lines.map((l) => parseInline(l.replace(/^\d+\.\s+/, ""))) });
    else blocks.push({ type: "p", parts: parseInline(lines.join(" ")) });
  }
  return blocks;
}
