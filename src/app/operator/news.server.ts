import { serviceDb } from "@/core/db/client.server";
import {
  NewsInputError,
  cleanNews,
  isMissingTable,
  type NewsInput,
  type NewsPlanTier,
  type NewsRow,
} from "@/core/news/news";
import { serverFailure } from "@/lib/server-failure";

/**
 * Новости платформы, сторона оператора: черновик → «опубликовать» → архив.
 * Работает под служебным ключом; продавцу в базе видно только опубликованное
 * и не в архиве (политика в миграции 19-5).
 */
const PAGE = 1000;
const COLS = "id, title, body, plans, action, poll, published_at, archived, created_at, created_by";

export type OperatorNews = {
  id: string;
  title: Record<string, string>;
  body: Record<string, string>;
  plans: NewsPlanTier[];
  publishedAt: string | null;
  archived: boolean;
  createdAt: string;
};

function texts(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(
    Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

function toOperatorNews(r: NewsRow): OperatorNews {
  return {
    id: r.id,
    title: texts(r.title),
    body: texts(r.body),
    plans: r.plans as NewsPlanTier[],
    publishedAt: r.published_at,
    archived: r.archived,
    createdAt: r.created_at,
  };
}

/** Все новости (черновики, опубликованные, архив), новые сверху; null — раздел выключен. */
export async function listNews(): Promise<OperatorNews[] | null> {
  const db = serviceDb();
  const out: NewsRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("platform_news")
      .select(COLS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw serverFailure(`[operator] новости не прочитаны: ${error.message}`);
    }
    const rows = (data ?? []) as NewsRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.map(toOperatorNews);
}

/** Новая новость (черновик) или правка существующей. */
export async function saveNews(
  id: string | null,
  input: NewsInput,
  operator: string,
): Promise<OperatorNews> {
  const clean = cleanNews(input);
  const db = serviceDb();
  if (!id) {
    const { data, error } = await db
      .from("platform_news")
      .insert({
        ...clean,
        created_by: operator.slice(0, 80),
        created_at: new Date().toISOString(),
        archived: false,
        published_at: null,
      })
      .select(COLS)
      .single();
    if (error) {
      if (isMissingTable(error))
        throw new NewsInputError("Таблиц новостей в базе ещё нет: нужна миграция 19-5.");
      throw serverFailure(`[operator] новость не сохранена: ${error.message}`);
    }
    return toOperatorNews(data as NewsRow);
  }
  const { data, error } = await db.from("platform_news").update(clean).eq("id", id).select(COLS);
  if (error) throw serverFailure(`[operator] новость не сохранена: ${error.message}`);
  if (!data?.length) throw new NewsInputError("Новость не найдена.");
  return toOperatorNews(data[0] as NewsRow);
}

/**
 * Опубликовать (один раз: условно по «ещё не опубликована», повтор ничего
 * не меняет), в архив и обратно. Возвращает, изменилось ли что-то.
 */
export async function setNewsState(
  id: string,
  action: "publish" | "archive" | "unarchive",
): Promise<boolean> {
  const db = serviceDb();
  const base = db.from("platform_news");
  const q =
    action === "publish"
      ? base
          .update({ published_at: new Date().toISOString() })
          .eq("id", id)
          .is("published_at", null)
      : base
          .update({ archived: action === "archive" })
          .eq("id", id)
          .eq("archived", action !== "archive");
  const { data, error } = await q.select("id");
  if (error) throw serverFailure(`[operator] состояние новости не записано: ${error.message}`);
  return (data ?? []).length > 0;
}
