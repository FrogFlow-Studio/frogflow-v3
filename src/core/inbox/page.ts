import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  conversationsOf,
  STATE_COLUMNS,
  type StateRow,
  listConversationStates,
  listConversationStatesSince,
  listConversationStatesByIds,
  type ConversationCursor,
} from "@/core/chat/chat";
import {
  inboxChangedIds,
  inboxMetaFor,
  matchesInbox,
  mergeInbox,
  openTicketNumbers,
  type InboxFilter,
  type InboxItem,
} from "@/core/inbox/inbox";

/** Диалогов на странице списка. */
export const INBOX_PAGE = 50;
/** За раз читаем строк состояния при поиске подходящих под фильтр. */
const SCAN = 200;

export type InboxPage = { items: InboxItem[]; hasMore: boolean };

async function itemsOf(
  ctx: TenantContext,
  states: Parameters<typeof conversationsOf>[1],
): Promise<InboxItem[]> {
  const convs = await conversationsOf(ctx, states);
  const meta = await inboxMetaFor(
    ctx,
    convs.map((c) => c.telegram_id),
  );
  return mergeInbox(convs, meta);
}

async function withTickets(ctx: TenantContext, items: InboxItem[]): Promise<InboxItem[]> {
  if (!items.length || !ctx.tenant.modules.helpdesk) return items;
  const tickets = await openTicketNumbers(
    ctx,
    items.map((i) => i.telegram_id),
  );
  return items.map((i) => ({ ...i, tickets: tickets.get(i.telegram_id) ?? [] }));
}

/**
 * Страница списка диалогов: свежие сверху, порядок заканчивается telegram_id.
 * Статус и ответственный лежат в другой таблице, канал и имя — в третьей, поэтому
 * строки состояния читаются кусками, пока не наберётся страница подходящих;
 * «непрочитанные» отбираются уже в запросе. Конец списка — `hasMore: false`.
 */
export async function listInboxPage(
  ctx: TenantContext,
  q: { filter: InboxFilter; me: string; before?: ConversationCursor | null; limit?: number },
): Promise<InboxPage> {
  const limit = q.limit ?? INBOX_PAGE;
  const found: InboxItem[] = [];
  let cursor = q.before ?? null;
  for (;;) {
    const states = await listConversationStates(ctx, {
      before: cursor,
      limit: SCAN,
      unreadOnly: q.filter.unread,
    });
    if (!states.length) break;
    const chunk = await itemsOf(ctx, states);
    for (const i of chunk)
      if (matchesInbox({ ...i, tickets: [] }, q.filter, q.me)) found.push({ ...i, tickets: [] });
    const last = states[states.length - 1]!;
    cursor = { last_message_at: last.last_message_at, telegram_id: Number(last.telegram_id) };
    if (found.length > limit || states.length < SCAN) break;
  }
  const hasMore = found.length > limit;
  return { items: await withTickets(ctx, found.slice(0, limit)), hasMore };
}

/**
 * Диалоги, менявшиеся с `since` (включительно) — опрос берёт только их: с новой
 * репликой или со сменой статуса/ответственного (это другая таблица).
 */
export async function listInboxChanged(ctx: TenantContext, since: string): Promise<InboxItem[]> {
  const byMessage = await listConversationStatesSince(ctx, since);
  const have = new Set(byMessage.map((s) => Number(s.telegram_id)));
  const extra = (await inboxChangedIds(ctx, since)).filter((id) => !have.has(id));
  const states = [...byMessage, ...(await listConversationStatesByIds(ctx, extra))];
  const chunk = await itemsOf(ctx, states);
  return withTickets(
    ctx,
    chunk.map((i) => ({ ...i, tickets: [] })),
  );
}

/** Один диалог по telegram_id — открытый в окне, даже если он не попал в страницу списка. */
export async function getInboxItem(
  ctx: TenantContext,
  telegramId: number,
): Promise<InboxItem | null> {
  const { data, error } = await ctx.db
    .from("manager_chat_state")
    .select(STATE_COLUMNS)
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (error) throw serverFailure(`Чат: диалог: ${error.message}`);
  if (!data) return null;
  const [item] = await withTickets(ctx, await itemsOf(ctx, [data as StateRow]));
  return item ?? null;
}

export type InboxTotals = {
  total: number;
  open: number;
  mine: number;
  unassigned: number;
  unread: number;
};

/** Счётчики для вкладок — запросы `count`, без чтения самих диалогов. */
export async function inboxTotals(ctx: TenantContext, me: string): Promise<InboxTotals> {
  const prefix = `inbox:${ctx.tenant.id}:%`;
  const count = async (
    what: string,
    q: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  ) => {
    const { count: n, error } = await q;
    if (error) throw serverFailure(`Входящие: ${what}: ${error.message}`);
    return n ?? 0;
  };
  // Каждый запрос к zernio_logs идёт прямо от ctx.db.from("zernio_logs"): сканер колонок
  // (tests/db-columns.test.ts) не умеет следить за вспомогательной функцией.
  const [total, unread, closed, assignedOpen, mine] = await Promise.all([
    count(
      "диалоги",
      ctx.db.from("manager_chat_state").select("telegram_id", { count: "exact", head: true }),
    ),
    count(
      "непрочитанные",
      ctx.db
        .from("manager_chat_state")
        .select("telegram_id", { count: "exact", head: true })
        .gt("unread_count", 0),
    ),
    count(
      "решённые",
      ctx.db
        .from("zernio_logs")
        .select("id", { count: "exact", head: true })
        .like("event_id", prefix)
        .eq("status", "closed"),
    ),
    count(
      "с ответственным",
      ctx.db
        .from("zernio_logs")
        .select("id", { count: "exact", head: true })
        .like("event_id", prefix)
        .eq("status", "open")
        .not("payload->>assignee", "is", null),
    ),
    count(
      "мои",
      ctx.db
        .from("zernio_logs")
        .select("id", { count: "exact", head: true })
        .like("event_id", prefix)
        .eq("status", "open")
        .eq("payload->>assignee", me),
    ),
  ]);
  const open = Math.max(0, total - closed);
  return { total, open, mine, unassigned: Math.max(0, open - assignedOpen), unread };
}
