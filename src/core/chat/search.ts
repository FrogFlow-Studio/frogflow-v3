import { serverFailure } from "@/lib/server-failure";
import { inChunks } from "@/lib/in-chunks";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { ChatDirection, ChatSender, MessageCursor } from "./chat";

/** Находок на странице поиска по тексту переписки. */
export const SEARCH_PAGE = 20;
/** Короче этого искать нечего: подстрока из одной буквы находит всё. */
export const SEARCH_MIN = 2;

export type MessageHit = {
  id: string;
  telegramId: number;
  createdAt: string;
  direction: ChatDirection;
  sender: ChatSender;
  /** Кусок текста вокруг найденного. */
  snippet: string;
  name: string;
  platform: string;
};

/** Шаблон для ilike: «%», «_» и «\» в запросе — буквы, а не маски. */
export function likePattern(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;
}

/** Текст без разметки, обрезанный вокруг первого совпадения: «…размер 42, а у вас…». */
export function snippetOf(text: string, q: string, radius = 50): string {
  const plain = text
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const at = plain.toLowerCase().indexOf(q.trim().toLowerCase());
  if (at < 0 || plain.length <= radius * 2) return plain.slice(0, radius * 2);
  const from = Math.max(0, at - radius);
  const to = Math.min(plain.length, at + q.trim().length + radius);
  return `${from > 0 ? "…" : ""}${plain.slice(from, to)}${to < plain.length ? "…" : ""}`;
}

/**
 * Поиск по тексту переписки своего магазина: ilike по `manager_chat_messages.text`,
 * свежие сверху, страницы по курсору `(created_at, id)`. `hasMore` — есть ещё.
 * Короткий запрос — пусто, не «всё».
 */
export async function searchMessages(
  ctx: TenantContext,
  q: string,
  opts: { before?: MessageCursor | null; limit?: number } = {},
): Promise<{ hits: MessageHit[]; hasMore: boolean }> {
  const term = q.trim();
  if (term.length < SEARCH_MIN) return { hits: [], hasMore: false };
  const limit = opts.limit ?? SEARCH_PAGE;
  let query = ctx.db
    .from("manager_chat_messages")
    .select("id, telegram_id, direction, sender, text, created_at")
    .eq("bot_id", ctx.tenant.id)
    .ilike("text", likePattern(term));
  const b = opts.before;
  if (b)
    query = query.or(
      `created_at.lt.${b.created_at},and(created_at.eq.${b.created_at},id.lt.${b.id})`,
    );
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw serverFailure(`Поиск по переписке: ${error.message}`);
  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const users = await inChunks(
    page.map((r) => Number(r.telegram_id)),
    (chunk) =>
      ctx.db
        .from("bot_users")
        .select("telegram_id, username, first_name, last_name, platform")
        .eq("bot_id", ctx.tenant.id)
        .in("telegram_id", chunk),
    "Поиск по переписке: покупатели",
  );
  const byId = new Map(users.map((u) => [Number(u.telegram_id), u]));
  return {
    hits: page.map((r) => {
      const id = Number(r.telegram_id);
      const u = byId.get(id);
      const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ");
      return {
        id: r.id,
        telegramId: id,
        createdAt: r.created_at,
        direction: r.direction as ChatDirection,
        sender: r.sender as ChatSender,
        snippet: snippetOf(r.text, term),
        name: name || (u?.username ? `@${u.username}` : `id ${id}`),
        platform: u?.platform ?? "telegram",
      };
    }),
    hasMore: rows.length > limit,
  };
}
