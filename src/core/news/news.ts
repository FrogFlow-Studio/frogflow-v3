import type { Database, Json } from "@/core/db-types";
import { UserError } from "@/core/i18n/user-error";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { MODULES, type ModuleKey } from "@/core/modules/registry";
import { parsePlan } from "@/core/plans/registry";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Лента новостей платформы: оператор пишет, продавец видит «Что нового» и
 * бейдж непрочитанного. Таблицы `platform_news*` заведены миграцией 19-5;
 * пока она не применена, раздел выключен (`available: false`), без ошибок.
 *
 * Новость общая для всех клиентов; кому показывать — решает `plans`
 * (уровни тарифа; пусто — всем). Базовый запрет сделан и в базе (RLS отдаёт
 * продавцу только опубликованное), а выбор по тарифу — здесь: политика базы
 * не знает тарифа магазина.
 */
type Tables = Database["public"]["Tables"];
export type NewsRow = Tables["platform_news"]["Row"];

export const NEWS_PLAN_TIERS = ["basic", "pro", "business", "custom"] as const;
export type NewsPlanTier = (typeof NEWS_PLAN_TIERS)[number];
/** Ошибка ввода оператора: текст русский, в словарь продавца не входит (ключ служебный). */
export class NewsInputError extends UserError {
  constructor(message: string) {
    super("operator.input", message);
  }
}

export const NEWS_TITLE_MAX = 120;
export const NEWS_BODY_MAX = 4000;
const PAGE = 1000;
const IN_CHUNK = 200;

/**
 * Кнопка действия в новости (Ч6). «Включить» ведёт в «Модули» и показывается,
 * пока модуль у магазина выключен; «Подробнее» ведёт на страницу админки из
 * `NEWS_LINK_PATHS`. Внешних ссылок и произвольных путей нет.
 */
export type NewsAction = { kind: "module"; module: ModuleKey } | { kind: "link"; path: string };
export type NewsItemAction = { kind: "module" | "link"; href: string };

/** Страницы админки, на которые может вести «Подробнее». Каждая есть в маршрутах (тест). */
export const NEWS_LINK_PATHS = [
  "/admin",
  "/admin/orders",
  "/admin/products",
  "/admin/customers",
  "/admin/broadcasts",
  "/admin/discounts",
  "/admin/instagram",
  "/admin/analytics",
  "/admin/modules",
  "/admin/billing",
  "/admin/settings",
  "/admin/support",
  "/admin/help",
  "/admin/community",
] as const;
const QUERY_RE = /^\?[\w=&.%-]{1,100}$/;

/** Путь для «Подробнее»: страница из списка, не больше простого `?a=b`; иначе null. */
export function safeLinkPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const [base, ...rest] = path.split("?");
  if (!(NEWS_LINK_PATHS as readonly string[]).includes(base ?? "")) return null;
  if (rest.length === 0) return base!;
  const query = `?${rest.join("?")}`;
  return QUERY_RE.test(query) ? `${base}${query}` : null;
}

/** Действие из базы; всё непонятное — null (новость покажется без кнопки). */
export function parseAction(raw: Json | null): NewsAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, Json | undefined>;
  if (o.kind === "module" && typeof o.module === "string") {
    const def = (MODULES as Record<string, { status: string } | undefined>)[o.module];
    return def?.status === "available" ? { kind: "module", module: o.module as ModuleKey } : null;
  }
  if (o.kind === "link") {
    const path = safeLinkPath(o.path);
    return path ? { kind: "link", path } : null;
  }
  return null;
}

/** Опрос в новости (Ч7): 2–4 варианта, у каждого текст на языках; голос хранит номер варианта. */
export const POLL_MIN = 2;
export const POLL_MAX = 4;
export const POLL_OPTION_MAX = 80;
export type NewsPoll = { options: Record<string, string>[] };

/** Опрос из базы; нет или повреждён — null (новость покажется без опроса). */
export function parsePoll(raw: Json | null): NewsPoll | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const list = (raw as Record<string, Json | undefined>).options;
  if (!Array.isArray(list) || list.length < POLL_MIN || list.length > POLL_MAX) return null;
  const options: Record<string, string>[] = [];
  for (const o of list) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const texts: Record<string, string> = {};
    for (const l of SUPPORTED_LOCALES) {
      const v = (o as Record<string, Json | undefined>)[l];
      if (typeof v === "string" && v.trim()) texts[l] = v;
    }
    if (!texts.ru) return null;
    options.push(texts);
  }
  return { options };
}

export type NewsItemPoll = {
  /** Варианты на языке продавца; номер варианта — позиция в списке. */
  options: string[];
  /** За что проголосовал этот магазин; null — ещё не голосовал. */
  myVote: number | null;
};

export type NewsItem = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  read: boolean;
  action: NewsItemAction | null;
  poll: NewsItemPoll | null;
};

/** Куда ведёт кнопка у этого магазина: «Включить» пропадает, когда модуль уже включён. */
export function itemAction(
  action: NewsAction | null,
  modules: Partial<Record<ModuleKey, boolean>>,
): NewsItemAction | null {
  if (!action) return null;
  if (action.kind === "module")
    return modules[action.module] ? null : { kind: "module", href: "/admin/modules" };
  return { kind: "link", href: action.path };
}

export type NewsView =
  { available: false } | { available: true; items: NewsItem[]; unread: number };

/** Таблицы нет (миграция не применена). */
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}

/** Уровень тарифа магазина для выбора новостей: basic | pro | business | custom; нет плана — null. */
export function tenantTier(plan: string | null): NewsPlanTier | null {
  const p = parsePlan(plan);
  if (!p) return null;
  return p.kind === "custom" ? "custom" : p.tier;
}

/** Новость адресована магазину: пустой список — всем, иначе нужен уровень из списка. */
export function newsVisibleTo(plans: readonly string[], tier: NewsPlanTier | null): boolean {
  if (plans.length === 0) return true;
  return tier !== null && plans.includes(tier);
}

/** Текст на языке продавца; нет — русский; нет и его — любой из имеющихся. */
export function localized(value: Json, locale: Locale): string {
  const o = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const pick = (l: string) => {
    const v = (o as Record<string, Json | undefined>)[l];
    return typeof v === "string" && v.trim() ? v : null;
  };
  return pick(locale) ?? pick("ru") ?? SUPPORTED_LOCALES.map(pick).find((v) => v !== null) ?? "";
}

const NEWS_COLS =
  "id, title, body, plans, action, poll, published_at, archived, created_at, created_by";

/** Опубликованные новости, которые видит магазин (RLS + выбор по тарифу), от новых к старым. */
async function readVisible(ctx: TenantContext): Promise<NewsRow[] | null> {
  const tier = tenantTier(ctx.tenant.plan);
  const out: NewsRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.db
      .from("platform_news")
      .select(NEWS_COLS)
      .not("published_at", "is", null)
      .eq("archived", false)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw serverFailure(`Новости: ${error.message}`);
    }
    const rows = (data ?? []) as NewsRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.filter((n) => newsVisibleTo(n.plans, tier));
}

async function readReadIds(ctx: TenantContext): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.db
      .from("platform_news_reads")
      .select("news_id")
      .eq("bot_id", ctx.tenant.id)
      .order("news_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw serverFailure(`Новости: прочитанное не получено: ${error.message}`);
    for (const r of data ?? []) ids.add(r.news_id);
    if ((data ?? []).length < PAGE) return ids;
  }
}

function itemPoll(
  poll: NewsPoll | null,
  vote: number | undefined,
  locale: Locale,
): NewsItemPoll | null {
  if (!poll) return null;
  const mine = vote !== undefined && vote >= 0 && vote < poll.options.length ? vote : null;
  return { options: poll.options.map((o) => localized(o, locale)), myVote: mine };
}

/** Голоса этого магазина: новость → номер варианта. */
async function readMyVotes(ctx: TenantContext): Promise<Map<string, number>> {
  const votes = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.db
      .from("platform_news_votes")
      .select("news_id, option_ix")
      .eq("bot_id", ctx.tenant.id)
      .order("news_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw serverFailure(`Новости: голоса не получены: ${error.message}`);
    for (const r of data ?? []) votes.set(r.news_id, r.option_ix);
    if ((data ?? []).length < PAGE) return votes;
  }
}

export async function loadNews(ctx: TenantContext, locale: Locale): Promise<NewsView> {
  const rows = await readVisible(ctx);
  if (rows === null) return { available: false };
  const read = await readReadIds(ctx);
  const votes = rows.some((n) => parsePoll(n.poll))
    ? await readMyVotes(ctx)
    : new Map<string, number>();
  const items = rows.map((n) => ({
    id: n.id,
    title: localized(n.title, locale),
    body: localized(n.body, locale),
    publishedAt: n.published_at ?? n.created_at,
    read: read.has(n.id),
    action: itemAction(parseAction(n.action), ctx.tenant.modules),
    poll: itemPoll(parsePoll(n.poll), votes.get(n.id), locale),
  }));
  return { available: true, items, unread: items.filter((i) => !i.read).length };
}

/** Сколько новостей не прочитано (бейдж в меню); 0 — и когда раздел выключен. */
export async function newsUnread(ctx: TenantContext): Promise<number> {
  const v = await loadNews(ctx, "ru");
  return v.available ? v.unread : 0;
}

/**
 * Продавец открыл «Что нового»: все видимые ему новости прочитаны. Уже
 * прочитанные не трогаем (повтор — не ошибка и не перезапись времени).
 */
export async function markNewsRead(ctx: TenantContext): Promise<number> {
  const rows = await readVisible(ctx);
  if (rows === null) return 0;
  const read = await readReadIds(ctx);
  const fresh = rows.filter((n) => !read.has(n.id)).map((n) => n.id);
  const now = new Date().toISOString();
  for (let i = 0; i < fresh.length; i += IN_CHUNK) {
    const { error } = await ctx.db.from("platform_news_reads").upsert(
      fresh
        .slice(i, i + IN_CHUNK)
        .map((news_id) => ({ bot_id: ctx.tenant.id, news_id, read_at: now })),
      { onConflict: "bot_id,news_id", ignoreDuplicates: true },
    );
    if (error) throw serverFailure(`Новости: отметка «прочитано» не записана: ${error.message}`);
  }
  return fresh.length;
}

export const pollUnavailable = () => new UserError("err.news.noPoll", "Этот опрос недоступен.");

/**
 * Голос в опросе: один на магазин. Условие «один раз» держит первичный ключ
 * (магазин, новость): второй клик или вторая вкладка падают на 23505 и
 * не засчитываются — `counted: false`, без ошибки. Голосовать можно только в
 * опубликованной новости с опросом, адресованной этому магазину.
 */
export async function voteNews(
  ctx: TenantContext,
  newsId: string,
  option: number,
): Promise<{ counted: boolean }> {
  const rows = await readVisible(ctx);
  const poll = parsePoll(rows?.find((n) => n.id === newsId)?.poll ?? null);
  if (!poll || !Number.isInteger(option) || option < 0 || option >= poll.options.length)
    throw pollUnavailable();
  const { error } = await ctx.db.from("platform_news_votes").insert({
    bot_id: ctx.tenant.id,
    news_id: newsId,
    option_ix: option,
    voted_at: new Date().toISOString(),
  });
  if (error) {
    if (error.code === "23505") return { counted: false };
    throw serverFailure(`Новости: голос не записан: ${error.message}`);
  }
  return { counted: true };
}

/* ---------- ввод оператора ---------- */

export type NewsInput = {
  title: Partial<Record<Locale, string>>;
  body: Partial<Record<Locale, string>>;
  plans: NewsPlanTier[];
  /** Кнопка действия (Ч6); пусто — без кнопки. */
  action?: { kind: "module"; module: string } | { kind: "link"; path: string } | null;
  /**
   * Варианты опроса (Ч7): на каждом языке по варианту в строке. Русский обязателен
   * (2–4 строки), остальные языки — пусто или столько же строк. Пусто — без опроса.
   */
  pollOptions?: Partial<Record<Locale, string>>;
};

const lines = (v: string | undefined) =>
  (v ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/** Проверенный опрос оператора; пустой русский список — без опроса. */
export function cleanPoll(input: NewsInput["pollOptions"]): NewsPoll | null {
  const ru = lines(input?.ru);
  const others = SUPPORTED_LOCALES.filter((l) => l !== "ru").map(
    (l) => [l, lines(input?.[l])] as const,
  );
  if (ru.length === 0 && others.every(([, v]) => v.length === 0)) return null;
  if (ru.length < POLL_MIN || ru.length > POLL_MAX)
    throw new NewsInputError(`Опрос: нужно от ${POLL_MIN} до ${POLL_MAX} вариантов по-русски.`);
  for (const [l, v] of others)
    if (v.length !== 0 && v.length !== ru.length)
      throw new NewsInputError(
        `Опрос (${l}): вариантов ${v.length}, а по-русски ${ru.length}. Столько же или пусто.`,
      );
  const options = ru.map((text, i) => {
    const o: Record<string, string> = { ru: text };
    for (const [l, v] of others) if (v[i]) o[l] = v[i]!;
    for (const t of Object.values(o))
      if (t.length > POLL_OPTION_MAX)
        throw new NewsInputError(`Опрос: вариант длиннее ${POLL_OPTION_MAX} знаков.`);
    return o;
  });
  return { options };
}

/** Проверенное действие оператора: неизвестный модуль, не готовый модуль и чужой путь — ошибка ввода. */
export function cleanAction(input: NewsInput["action"]): NewsAction | null {
  if (!input) return null;
  if (input.kind === "module") {
    const def = (MODULES as Record<string, { status: string } | undefined>)[input.module];
    if (!def) throw new NewsInputError(`Кнопка «Включить»: нет модуля «${input.module}».`);
    if (def.status !== "available")
      throw new NewsInputError(`Кнопка «Включить»: модуль «${input.module}» ещё не готов.`);
    return { kind: "module", module: input.module as ModuleKey };
  }
  const path = safeLinkPath(input.path);
  if (!path)
    throw new NewsInputError(
      "Кнопка «Подробнее»: можно вести только на страницу админки из списка.",
    );
  return { kind: "link", path };
}

function cleanTexts(
  raw: Partial<Record<Locale, string>>,
  max: number,
  what: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of SUPPORTED_LOCALES) {
    const v = (raw[l] ?? "").replace(/\r\n/g, "\n").trim();
    if (v.length > max) throw new NewsInputError(`${what} (${l}) длиннее ${max} знаков.`);
    if (v) out[l] = v;
  }
  // Русский — источник: без него другим языкам не на что откатиться.
  if (!out.ru) throw new NewsInputError(`${what}: нужен русский текст.`);
  return out;
}

/** Проверенные поля новости; тексты пустых языков не пишем (продавец увидит русский). */
export function cleanNews(input: NewsInput): {
  title: Record<string, string>;
  body: Record<string, string>;
  plans: NewsPlanTier[];
  action: NewsAction | null;
  poll: NewsPoll | null;
} {
  const plans = [...new Set(input.plans)].filter((p) =>
    (NEWS_PLAN_TIERS as readonly string[]).includes(p),
  );
  return {
    title: cleanTexts(input.title, NEWS_TITLE_MAX, "Заголовок"),
    body: cleanTexts(input.body, NEWS_BODY_MAX, "Текст"),
    plans,
    action: cleanAction(input.action),
    poll: cleanPoll(input.pollOptions),
  };
}
