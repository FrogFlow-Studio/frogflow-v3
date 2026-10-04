import type { Database, Json } from "@/core/db-types";
import { UserError } from "@/core/i18n/user-error";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
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

export type NewsItem = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  read: boolean;
};

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

export async function loadNews(ctx: TenantContext, locale: Locale): Promise<NewsView> {
  const rows = await readVisible(ctx);
  if (rows === null) return { available: false };
  const read = await readReadIds(ctx);
  const items = rows.map((n) => ({
    id: n.id,
    title: localized(n.title, locale),
    body: localized(n.body, locale),
    publishedAt: n.published_at ?? n.created_at,
    read: read.has(n.id),
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

/* ---------- ввод оператора ---------- */

export type NewsInput = {
  title: Partial<Record<Locale, string>>;
  body: Partial<Record<Locale, string>>;
  plans: NewsPlanTier[];
};

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
} {
  const plans = [...new Set(input.plans)].filter((p) =>
    (NEWS_PLAN_TIERS as readonly string[]).includes(p),
  );
  return {
    title: cleanTexts(input.title, NEWS_TITLE_MAX, "Заголовок"),
    body: cleanTexts(input.body, NEWS_BODY_MAX, "Текст"),
    plans,
  };
}
