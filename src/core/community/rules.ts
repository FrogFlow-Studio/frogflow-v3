/**
 * Правила тем и ответов сообщества (С2): разделы, проверка текста, защита от спама,
 * безопасный поисковый запрос. Чистые функции — без базы.
 */
export const SECTIONS = ["questions", "experience", "offers"] as const;
export type Section = (typeof SECTIONS)[number];
/** Подразделы «Ищу / предлагаю». */
export const OFFER_TOPICS = ["packaging", "photo", "delivery", "contractors"] as const;
export type OfferTopic = (typeof OFFER_TOPICS)[number];

export const THREAD_LIMITS = {
  title: 140,
  titleMin: 3,
  body: 4000,
  reason: 300,
  search: 80,
} as const;

/** Не больше N новых записей автора за окно: тема и ответ считаются вместе. */
export const SPAM_LIMITS = {
  /** Любых записей (тем и ответов) за последний час. */
  perHour: 10,
  /** Новых тем за сутки. */
  threadsPerDay: 3,
} as const;

/** Размер страницы списков; дальше — «Показать ещё» по смещению. */
export const COMMUNITY_PAGE = 20;

export const isSection = (v: unknown): v is Section =>
  typeof v === "string" && (SECTIONS as readonly string[]).includes(v);
export const isOfferTopic = (v: unknown): v is OfferTopic =>
  typeof v === "string" && (OFFER_TOPICS as readonly string[]).includes(v);

const oneLine = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
/** Текст сообщения: переносы строк сохраняются, лишние пустые строки схлопываются. */
const multiline = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max)
    : "";

export type NewThread = { section: Section; topic: OfferTopic | null; title: string; body: string };

export type CleanResult<T> =
  { ok: true; value: T } | { ok: false; error: "title" | "body" | "section" };

export function cleanThread(raw: {
  section: unknown;
  topic?: unknown;
  title: unknown;
  body: unknown;
}): CleanResult<NewThread> {
  if (!isSection(raw.section)) return { ok: false, error: "section" };
  const title = oneLine(raw.title, THREAD_LIMITS.title);
  if (title.length < THREAD_LIMITS.titleMin) return { ok: false, error: "title" };
  const body = multiline(raw.body, THREAD_LIMITS.body);
  if (!body) return { ok: false, error: "body" };
  const topic = raw.section === "offers" && isOfferTopic(raw.topic) ? raw.topic : null;
  return { ok: true, value: { section: raw.section, topic, title, body } };
}

export function cleanPost(raw: unknown): string | null {
  return multiline(raw, THREAD_LIMITS.body) || null;
}

export function cleanReason(raw: unknown): string | null {
  return oneLine(raw, THREAD_LIMITS.reason) || null;
}

export type SpamVerdict = "ok" | "hour" | "day";

/** Можно ли автору написать ещё: `lastHour` — записей за час, `threadsToday` — тем за сутки. */
export function spamVerdict(
  counts: { lastHour: number; threadsToday: number },
  isThread: boolean,
): SpamVerdict {
  if (counts.lastHour >= SPAM_LIMITS.perHour) return "hour";
  if (isThread && counts.threadsToday >= SPAM_LIMITS.threadsPerDay) return "day";
  return "ok";
}

/**
 * Поисковая строка для ilike: без `%`, `_`, `\`, запятых и скобок (они ломают разбор `.or(...)`).
 * Пусто — поиска нет.
 */
export function searchTerm(raw: unknown): string {
  return oneLine(raw, THREAD_LIMITS.search)
    .replace(/[%_\\,()*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Столько жалоб от разных авторов на одну запись скрывают её до решения оператора (С4). */
export const AUTO_HIDE_REPORTS = 3;

/** Разделы админки, с которых можно «Спросить совет». Название в теме — только это. */
export const ADVICE_PAGES = ["warehouse", "discounts"] as const;
export type AdvicePage = (typeof ADVICE_PAGES)[number];
export const isAdvicePage = (v: unknown): v is AdvicePage =>
  typeof v === "string" && (ADVICE_PAGES as readonly string[]).includes(v);

export type AdviceProblem = "contact" | "money";

/**
 * Вопрос в сообщество пишет сам автор, а у магазина есть то, что наружу уходить не должно:
 * контакты покупателей и суммы. Простая защита: в вопросе не пропускаем почту, телефон, длинные
 * номера, ссылки на мессенджеры и @имена, а также суммы с валютой. Это страховка от случайного
 * копирования, а не гарантия: данные магазина сами в тему не подставляются никогда.
 */
export function adviceProblems(text: string): AdviceProblem[] {
  const out = new Set<AdviceProblem>();
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) out.add("contact");
  if (/(?:^|[\s(])@[a-z0-9_]{3,}/i.test(text)) out.add("contact");
  if (/(?:t\.me|wa\.me|instagram\.com|ig\.me)\//i.test(text)) out.add("contact");
  // Телефон: 10 и больше цифр с пробелами, скобками и дефисами между ними.
  if (/(?:\+?\d[\s\-().]*){10,}/.test(text)) out.add("contact");
  // Суммы: число рядом с валютой (15 000 ₸, 20000 тг, $50, 300 руб).
  if (
    /\d[\d\s.,]*\s*(?:₸|тг(?![а-яё])|тенге|kzt|₽|руб|rub|\$|usd|€|eur|сум(?![а-яё])|сом(?![а-яё]))/i.test(
      text,
    ) ||
    /(?:₸|\$|€|₽)\s*\d/.test(text)
  )
    out.add("money");
  return [...out];
}
