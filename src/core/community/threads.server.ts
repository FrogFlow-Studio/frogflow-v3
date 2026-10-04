import { serviceDb } from "@/core/db/client.server";
import { UserError } from "@/core/i18n/user-error";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { CommunityNotReady, isMissingTable } from "./not-ready";
import {
  COMMUNITY_PAGE,
  cleanPost,
  cleanReason,
  cleanThread,
  isOfferTopic,
  searchTerm,
  spamVerdict,
  type OfferTopic,
  type Section,
} from "./rules";
import { communityProfile, communityState, takesPartInCommunity } from "./profile";

/**
 * Темы и ответы сообщества (С2). Данные общие для авторов, поэтому читаются и пишутся
 * через serviceDb (RLS без политик, см. migrations/19-2): до любой операции проверяется
 * согласие автора (`takesPartInCommunity`), а чужие тексты показываются, только пока их
 * автор сам в сообществе и не заблокирован. Таблиц может не быть — тогда CommunityNotReady.
 */
type DbErr = { code?: string | undefined; message: string } | null;
function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new CommunityNotReady();
  throw serverFailure(`сообщество, ${what}: ${error.message}`);
}

function requireMember(ctx: Pick<TenantContext, "tenant">): void {
  if (!takesPartInCommunity(ctx.tenant)) {
    throw new UserError(
      "err.community.notJoined",
      "Сначала включите «Показывать меня в сообществе» в настройках.",
    );
  }
}

/** Кто виден в сообществе: bot_id → подпись. Тексты остальных (выключил, заблокирован) не показываем. */
type Author = { name: string | null };
async function authors(): Promise<Map<string, Author>> {
  const out = new Map<string, Author>();
  for (const t of await tenantDirectory()) {
    const s = communityState(t);
    if (s === "visible") out.set(t.id, { name: communityProfile(t.settings).name });
    else if (s === "hidden") out.set(t.id, { name: null });
  }
  return out;
}

export type ThreadItem = {
  id: string;
  section: Section;
  topic: OfferTopic | null;
  title: string;
  excerpt: string;
  author: string | null;
  mine: boolean;
  posts: number;
  lastPostAt: string;
  createdAt: string;
};

type ThreadRow = {
  id: string;
  bot_id: string;
  section: string;
  topic: string | null;
  title: string;
  body: string;
  posts_count: number;
  last_post_at: string;
  created_at: string;
};
const THREAD_COLS =
  "id, bot_id, section, topic, title, body, posts_count, last_post_at, created_at";
const SCAN_BATCH = 50;
const SCAN_BATCHES = 10;

const excerpt = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s);

/**
 * Список тем раздела. Страница — не больше COMMUNITY_PAGE видимых тем; `next` — смещение для
 * «Показать ещё» (по несмотренным строкам, ничего не теряется), null — конец.
 */
export async function listThreads(
  ctx: TenantContext,
  q: { section: Section; topic?: OfferTopic | null; search?: string; offset?: number },
): Promise<{ threads: ThreadItem[]; next: number | null }> {
  requireMember(ctx);
  const who = await authors();
  const term = searchTerm(q.search);
  const out: ThreadItem[] = [];
  let offset = Math.max(0, Math.floor(q.offset ?? 0));
  for (let i = 0; i < SCAN_BATCHES; i++) {
    let query = serviceDb()
      .from("community_threads")
      .select(THREAD_COLS)
      .eq("hidden", false)
      .eq("section", q.section);
    if (q.section === "offers" && q.topic && isOfferTopic(q.topic))
      query = query.eq("topic", q.topic);
    if (term) query = query.or(`title.ilike.%${term}%,body.ilike.%${term}%`);
    const { data, error } = await query
      .order("last_post_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + SCAN_BATCH - 1);
    check("список тем не прочитан", error);
    const rows = (data ?? []) as ThreadRow[];
    for (const r of rows) {
      offset++;
      const a = who.get(r.bot_id);
      if (!a) continue;
      out.push({
        id: r.id,
        section: r.section as Section,
        topic: (r.topic as OfferTopic | null) ?? null,
        title: r.title,
        excerpt: excerpt(r.body),
        author: a.name,
        mine: r.bot_id === ctx.tenant.id,
        posts: r.posts_count,
        lastPostAt: r.last_post_at,
        createdAt: r.created_at,
      });
      if (out.length >= COMMUNITY_PAGE) {
        // Строки этой пачки после последней взятой читаются в следующий раз.
        return { threads: out, next: offset };
      }
    }
    if (rows.length < SCAN_BATCH) return { threads: out, next: null };
  }
  return { threads: out, next: offset };
}

export type PostItem = {
  id: string;
  body: string;
  author: string | null;
  mine: boolean;
  createdAt: string;
};
export type ThreadView = {
  thread: Omit<ThreadItem, "excerpt"> & { body: string };
  posts: PostItem[];
  next: number | null;
};

const POST_BATCH = 50;

export async function getThread(ctx: TenantContext, id: string, offset = 0): Promise<ThreadView> {
  requireMember(ctx);
  const who = await authors();
  const { data, error } = await serviceDb()
    .from("community_threads")
    .select(THREAD_COLS)
    .eq("id", id)
    .eq("hidden", false)
    .maybeSingle();
  check("тема не прочитана", error);
  const t = data as ThreadRow | null;
  const a = t ? who.get(t.bot_id) : undefined;
  if (!t || !a) throw new UserError("err.community.noThread", "Этой темы нет или она скрыта.");
  const from = Math.max(0, Math.floor(offset));
  const { data: rows, error: pe } = await serviceDb()
    .from("community_posts")
    .select("id, bot_id, body, created_at")
    .eq("thread_id", id)
    .eq("hidden", false)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + POST_BATCH - 1);
  check("ответы не прочитаны", pe);
  const posts: PostItem[] = [];
  for (const r of rows ?? []) {
    const pa = who.get(r.bot_id);
    if (!pa) continue;
    posts.push({
      id: r.id,
      body: r.body,
      author: pa.name,
      mine: r.bot_id === ctx.tenant.id,
      createdAt: r.created_at,
    });
  }
  return {
    thread: {
      id: t.id,
      section: t.section as Section,
      topic: (t.topic as OfferTopic | null) ?? null,
      title: t.title,
      body: t.body,
      author: a.name,
      mine: t.bot_id === ctx.tenant.id,
      posts: t.posts_count,
      lastPostAt: t.last_post_at,
      createdAt: t.created_at,
    },
    posts,
    next: (rows ?? []).length < POST_BATCH ? null : from + POST_BATCH,
  };
}

async function count(
  what: string,
  table: "community_threads" | "community_posts",
  botId: string,
  sinceMs: number,
): Promise<number> {
  const { count: n, error } = await serviceDb()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId)
    .gte("created_at", new Date(Date.now() - sinceMs).toISOString());
  check(what, error);
  return n ?? 0;
}

/** Защита от спама: записей за час (темы и ответы вместе) и новых тем за сутки. */
async function spamCheck(ctx: TenantContext, isThread: boolean): Promise<void> {
  const HOUR = 3_600_000;
  const id = ctx.tenant.id;
  const [threads1h, posts1h] = await Promise.all([
    count("лимит тем (час)", "community_threads", id, HOUR),
    count("лимит ответов (час)", "community_posts", id, HOUR),
  ]);
  const threadsToday = isThread
    ? await count("лимит тем (сутки)", "community_threads", id, 24 * HOUR)
    : 0;
  const v = spamVerdict({ lastHour: threads1h + posts1h, threadsToday }, isThread);
  if (v === "hour")
    throw new UserError(
      "err.community.spamHour",
      "Слишком много сообщений за час. Попробуйте позже.",
    );
  if (v === "day")
    throw new UserError(
      "err.community.spamDay",
      "Сегодня вы создали достаточно тем. Продолжите завтра.",
    );
}

export async function createThread(
  ctx: TenantContext,
  input: { section: unknown; topic?: unknown; title: unknown; body: unknown },
): Promise<{ id: string }> {
  requireMember(ctx);
  const c = cleanThread(input);
  if (!c.ok) {
    if (c.error === "title")
      throw new UserError("err.community.title", "Заголовок — от 3 символов.");
    if (c.error === "body") throw new UserError("err.community.body", "Напишите текст.");
    throw new UserError("err.community.section", "Выберите раздел.");
  }
  await spamCheck(ctx, true);
  const { data, error } = await serviceDb()
    .from("community_threads")
    .insert({
      bot_id: ctx.tenant.id,
      section: c.value.section,
      topic: c.value.topic,
      title: c.value.title,
      body: c.value.body,
      hidden: false,
      posts_count: 0,
      last_post_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  check("тема не создана", error);
  return { id: data!.id };
}

export async function createPost(
  ctx: TenantContext,
  threadId: string,
  body: unknown,
): Promise<{ id: string }> {
  requireMember(ctx);
  const text = cleanPost(body);
  if (!text) throw new UserError("err.community.body", "Напишите текст.");
  const who = await authors();
  const { data: t, error: te } = await serviceDb()
    .from("community_threads")
    .select("id, bot_id")
    .eq("id", threadId)
    .eq("hidden", false)
    .maybeSingle();
  check("тема не прочитана", te);
  if (!t || !who.has(t.bot_id))
    throw new UserError("err.community.noThread", "Этой темы нет или она скрыта.");
  await spamCheck(ctx, false);
  const { data, error } = await serviceDb()
    .from("community_posts")
    .insert({
      thread_id: threadId,
      bot_id: ctx.tenant.id,
      body: text,
      hidden: false,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  check("ответ не создан", error);
  await recount(threadId);
  return { id: data!.id };
}

/** Пересчитать видимые ответы темы и время последнего: пишется точное число, а не «+1». */
export async function recount(threadId: string, bump = true): Promise<void> {
  const { count: n, error } = await serviceDb()
    .from("community_posts")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("hidden", false);
  check("ответы темы не посчитаны", error);
  const { error: ue } = await serviceDb()
    .from("community_threads")
    .update({ posts_count: n ?? 0, ...(bump ? { last_post_at: new Date().toISOString() } : {}) })
    .eq("id", threadId);
  check("тема не обновлена", ue);
}

/** Пожаловаться на тему или ответ. Повторная жалоба того же автора — не ошибка, а `already`. */
export async function reportContent(
  ctx: TenantContext,
  input: { threadId: string; postId?: string | null; reason?: unknown },
): Promise<{ already: boolean }> {
  requireMember(ctx);
  const postId = input.postId ?? null;
  let owner: string | null = null;
  if (postId) {
    const { data, error } = await serviceDb()
      .from("community_posts")
      .select("bot_id, thread_id")
      .eq("id", postId)
      .eq("thread_id", input.threadId)
      .maybeSingle();
    check("ответ для жалобы не прочитан", error);
    owner = data?.bot_id ?? null;
  } else {
    const { data, error } = await serviceDb()
      .from("community_threads")
      .select("bot_id")
      .eq("id", input.threadId)
      .maybeSingle();
    check("тема для жалобы не прочитана", error);
    owner = data?.bot_id ?? null;
  }
  if (!owner) throw new UserError("err.community.noThread", "Этой темы нет или она скрыта.");
  if (owner === ctx.tenant.id)
    throw new UserError("err.community.ownReport", "На свою запись пожаловаться нельзя.");
  const { error } = await serviceDb()
    .from("community_reports")
    .insert({
      bot_id: ctx.tenant.id,
      thread_id: input.threadId,
      post_id: postId,
      reason: cleanReason(input.reason),
      status: "open",
      created_at: new Date().toISOString(),
    });
  if (error?.code === "23505") return { already: true };
  check("жалоба не сохранена", error);
  return { already: false };
}
