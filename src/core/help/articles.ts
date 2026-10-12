import type { Locale } from "@/core/i18n/locale";

/**
 * База знаний «Помощь»: статьи — файлы `docs/help/<slug>.<язык>.md` (таблицы
 * нет). Первая строка — `# Заголовок`, за ней строки-сведения:
 * `keywords: слово, синоним, …` (по ним находят, когда в тексте статьи нужного
 * слова нет), `group: start|guide|trouble` (пункт меню «Помощь»: быстрый старт,
 * справочник по разделам, «что делать, если»), `order: 10` (порядок в пункте),
 * `pages: /admin/settings, /admin/modules` (страницы, у заголовка которых «?»
 * открывает эту статью). Дальше тело: абзацы, нумерованные списки, ссылки
 * `[текст](/admin/…)` и подзаголовки `## Текст {#якорь}` — к якорю ведёт «?»
 * рядом с переключателем. У каждой статьи обязаны быть все четыре языка — это
 * проверяет тест.
 */
const RAW = import.meta.glob("../../../docs/help/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const HELP_GROUPS = ["start", "guide", "trouble"] as const;
export type HelpGroup = (typeof HELP_GROUPS)[number];

export type HelpArticle = {
  slug: string;
  locale: Locale;
  title: string;
  keywords: string[];
  /** Пункт меню «Помощь»; нет — статья только в поиске. */
  group: HelpGroup | null;
  order: number;
  /** Страницы админки, у заголовка которых «?» открывает эту статью. */
  pages: string[];
  body: string;
};

const META = /^(keywords|group|order|pages):\s*(.*)$/i;
const list = (v: string) =>
  v
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

export function parseArticle(slug: string, locale: Locale, raw: string): HelpArticle {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const title = /^#\s+(.+)$/.exec(lines[0] ?? "")?.[1]?.trim() ?? slug;
  // Сведения — подряд после заголовка; Prettier может вставить пустые строки между ними.
  const meta: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (!l) continue;
    const m = META.exec(l);
    if (!m) break;
    meta[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  const group = (HELP_GROUPS as readonly string[]).includes(meta.group ?? "")
    ? (meta.group as HelpGroup)
    : null;
  const order = Number(meta.order);
  return {
    slug,
    locale,
    title,
    keywords: list(meta.keywords ?? ""),
    group,
    order: Number.isFinite(order) ? order : 999,
    pages: list(meta.pages ?? ""),
    body: lines.slice(i).join("\n").trim(),
  };
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

/** Статьи пункта меню «Помощь» по порядку. */
export function helpGroup(group: HelpGroup, locale: Locale): HelpArticle[] {
  return helpList(locale)
    .filter((a) => a.group === group)
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

/**
 * Статья для «?» у заголовка страницы: та, что объявила этот адрес в `pages:`
 * (сведения берутся из русской статьи — она источник). Адрес сверяется целиком
 * или префиксом раздела: `/admin/orders/123` → статья про `/admin/orders`.
 */
export function helpForPath(path: string, locale: Locale): HelpArticle | null {
  const clean = path.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  let best: { slug: string; len: number } | null = null;
  for (const a of HELP_ARTICLES) {
    if (a.locale !== "ru") continue;
    for (const p of a.pages) {
      // Префиксом — только разделы: «/admin» (обзор) не накрывает всю админку.
      const section = p.split("/").filter(Boolean).length >= 2;
      if ((clean === p || (section && clean.startsWith(`${p}/`))) && (!best || p.length > best.len))
        best = { slug: a.slug, len: p.length };
    }
  }
  return best ? helpArticle(best.slug, locale) : null;
}

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
 * уверенные совпадения (не меньше двух баллов и хотя бы одно слово в ключевых
 * словах или заголовке), чтобы не предлагать случайное: «спасибо большое»
 * находило в тексте «Каналов» «спасибо» и «больше» — два балла из одного тела.
 */
export function suggestHelp(text: string, locale: Locale, max = 3): HelpArticle[] {
  const words = queryWords(text);
  if (!words.length) return [];
  return helpList(locale)
    .map((a) => ({ a, s: scoreArticle(a, words) }))
    .filter((x) => x.s >= 2 && scoreArticle({ ...x.a, body: "" }, words) > 0)
    .sort((x, y) => y.s - x.s || x.a.slug.localeCompare(y.a.slug))
    .slice(0, max)
    .map((x) => x.a);
}

/* ---------- простая разметка тела ---------- */

export type HelpBlock =
  | { type: "p"; parts: HelpPart[] }
  | { type: "ol"; items: HelpPart[][] }
  | { type: "ul"; items: HelpPart[][] }
  | { type: "h"; text: string; id: string | null };
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

/** Подзаголовок `## Текст {#якорь}`: якорь — то, на что ссылается «?» у переключателя. */
export function parseHeading(line: string): { text: string; id: string | null } | null {
  const m = /^##\s+(.+?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/.exec(line.trim());
  return m ? { text: m[1]!, id: m[2] ?? null } : null;
}

/** Якоря статьи по порядку. */
export function articleAnchors(body: string): string[] {
  return body
    .split("\n")
    .map((l) => parseHeading(l)?.id)
    .filter((x): x is string => Boolean(x));
}

export function parseBody(body: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  // Подзаголовок — всегда отдельный блок, даже без пустой строки после него.
  const text = body.replace(/^(##\s.*)$/gm, "\n$1\n");
  for (const chunk of text.split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const h = lines.length === 1 ? parseHeading(lines[0]!) : null;
    if (h) blocks.push({ type: "h", ...h });
    else if (lines.every((l) => /^[-*]\s/.test(l)))
      blocks.push({ type: "ul", items: lines.map((l) => parseInline(l.replace(/^[-*]\s+/, ""))) });
    else if (lines.every((l) => /^\d+\.\s/.test(l)))
      blocks.push({ type: "ol", items: lines.map((l) => parseInline(l.replace(/^\d+\.\s+/, ""))) });
    else blocks.push({ type: "p", parts: parseInline(lines.join(" ")) });
  }
  return blocks;
}
