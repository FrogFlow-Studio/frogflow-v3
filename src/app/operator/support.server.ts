import { serviceDb } from "@/core/db/client.server";
import { UserError } from "@/core/i18n/user-error";
import {
  MESSAGE_COLS,
  cleanBody,
  ensureOpenThread,
  isMissingTable,
  latestThread,
  readMessages,
  toSupportMessage,
  writeThread,
  type SupportMessage,
  type ThreadRow,
  type ThreadStatus,
  type MessageRow,
} from "@/core/support/support";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Поддержка со стороны оператора: входящие по всем клиентам и ответ. Работает
 * под служебным ключом (платформа, не домен клиента); продавец видит только
 * своё — это держит RLS на его стороне (core/support/support.ts).
 */
const PAGE = 1000;

export type InboxRow = {
  threadId: string;
  botId: string;
  client: string;
  status: ThreadStatus;
  lastMessageAt: string;
  unread: number;
};

/** Незакрытые обращения всех клиентов: непрочитанные и самые давние сверху; null — раздел выключен. */
export async function supportInbox(): Promise<{ rows: InboxRow[]; resolved: number } | null> {
  const db = serviceDb();
  const threads: ThreadRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("platform_threads")
      .select(
        "id, bot_id, status, labels, created_at, last_message_at, last_seller_message_at, last_operator_message_at, first_response_at, due_at, seller_unread, operator_unread, rev",
      )
      .neq("status", "resolved")
      .order("last_message_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw serverFailure(`[operator] входящие поддержки не прочитаны: ${error.message}`);
    }
    const rows = (data ?? []) as ThreadRow[];
    threads.push(...rows);
    if (rows.length < PAGE) break;
  }
  const { count, error: countError } = await db
    .from("platform_threads")
    .select("id", { count: "exact", head: true })
    .eq("status", "resolved");
  if (countError)
    throw serverFailure(`[operator] решённые обращения не посчитаны: ${countError.message}`);
  const names = new Map((await tenantDirectory()).map((t) => [t.id, t.name]));
  const rows = threads
    .map((t) => ({
      threadId: t.id,
      botId: t.bot_id,
      client: names.get(t.bot_id) ?? "—",
      status: t.status as ThreadStatus,
      lastMessageAt: t.last_message_at,
      unread: t.operator_unread,
    }))
    .sort(
      (a, b) =>
        Number(b.unread > 0) - Number(a.unread > 0) ||
        a.lastMessageAt.localeCompare(b.lastMessageAt) ||
        a.threadId.localeCompare(b.threadId),
    );
  return { rows, resolved: count ?? 0 };
}

export type OperatorThreadView = {
  client: string;
  status: ThreadStatus | null;
  messages: SupportMessage[];
};

/** Переписка с одним клиентом; открыть — значит прочитать: счётчик оператора гаснет. */
export async function supportConversation(botId: string): Promise<OperatorThreadView | null> {
  const db = serviceDb();
  const rows = await readMessages(db, botId);
  if (rows === null) return null;
  const thread = await latestThread(db, botId).catch((e: unknown) => {
    if (e instanceof UserError) return null;
    throw e;
  });
  if (thread && thread.operator_unread > 0)
    await writeThread(db, thread.id, (t) =>
      t.operator_unread > 0 ? { operator_unread: 0 } : null,
    );
  const { error } = await db
    .from("platform_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("bot_id", botId)
    .eq("author", "seller")
    .is("read_at", null);
  if (error) throw serverFailure(`[operator] отметка «прочитано» не записана: ${error.message}`);
  const names = new Map((await tenantDirectory()).map((t) => [t.id, t.name]));
  return {
    client: names.get(botId) ?? "—",
    status: thread ? (thread.status as ThreadStatus) : null,
    messages: rows.map(toSupportMessage),
  };
}

/**
 * Ответ оператора. Закрытое обращение открывается заново; ждём продавца,
 * продавцу — непрочитанное, первый ответ запоминается (скорость ответа).
 */
export async function operatorReply(
  botId: string,
  input: { body: string; operator: string },
): Promise<{ message: SupportMessage; thread: ThreadRow }> {
  const body = cleanBody(input.body);
  const db = serviceDb();
  // Проверяем, что магазин есть: ответ в никуда не пишем.
  if (!(await tenantDirectory()).some((t) => t.id === botId))
    throw serverFailure("[operator] поддержка: клиент не найден");
  const thread = await ensureOpenThread(db, botId);
  const { data, error } = await db
    .from("platform_messages")
    .insert({
      bot_id: botId,
      thread_id: thread.id,
      author: "operator",
      author_name: input.operator.slice(0, 80) || null,
      body,
      created_at: new Date().toISOString(),
      read_at: null,
      notified_at: null,
    })
    .select(MESSAGE_COLS)
    .single();
  if (error) throw serverFailure(`[operator] ответ не записан: ${error.message}`);
  const now = new Date().toISOString();
  const updated = await writeThread(db, thread.id, (t) => ({
    status: "waiting_seller",
    last_message_at: now,
    last_operator_message_at: now,
    first_response_at: t.first_response_at ?? now,
    seller_unread: t.seller_unread + 1,
    operator_unread: 0,
  }));
  return { message: toSupportMessage(data as MessageRow), thread: updated ?? thread };
}
