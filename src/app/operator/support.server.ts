import { serviceDb } from "@/core/db/client.server";
import { UserError } from "@/core/i18n/user-error";
import {
  MESSAGE_COLS,
  SUPPORT_NOTE_MAX,
  THREAD_STATUSES,
  cleanBody,
  cleanLabels,
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
import {
  TYPICAL_WINDOW_DAYS,
  averageResponse,
  replyDue,
  typicalHours,
  type ResponseSample,
} from "@/core/support/response";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { logEvent } from "./operator.server";
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
  labels: string[];
  lastMessageAt: string;
  unread: number;
  /** Ждёт ответа оператора: до какого момента ответить и просрочено ли (рабочие часы, цель по тарифу). */
  reply: { due: string; overdue: boolean } | null;
};

export type ResponseSummary = { count: number; avgMinutes: number | null };

/** Первые ответы за 30 дней: обращение создано → оператор ответил (постранично, ключ сортировки — id). */
async function responseSamples(now: Date): Promise<ResponseSample[] | null> {
  const since = new Date(now.getTime() - TYPICAL_WINDOW_DAYS * 86_400_000).toISOString();
  const out: ResponseSample[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await serviceDb()
      .from("platform_threads")
      .select("id, created_at, first_response_at")
      .gte("first_response_at", since)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw serverFailure(`[operator] скорость ответа поддержки не прочитана: ${error.message}`);
    }
    for (const r of data ?? [])
      if (r.first_response_at)
        out.push({ startedAt: r.created_at, respondedAt: r.first_response_at });
    if ((data ?? []).length < PAGE) return out;
  }
}

/**
 * «Обычно отвечаем за N рабочих часов» для продавца: по фактам платформы за 30
 * дней; мало данных или раздел выключен — null (текста нет). Ошибка чтения
 * тоже даёт null: подсказка не стоит сломанной страницы, лучше без обещания.
 */
export async function typicalResponseHours(now = new Date()): Promise<number | null> {
  try {
    const samples = await responseSamples(now);
    return samples ? typicalHours(samples, now) : null;
  } catch (e) {
    console.error("[support] «обычно отвечаем» не посчитано", e);
    return null;
  }
}

export type InboxFilter = { status?: ThreadStatus; label?: string };
export type StatusCounts = Record<ThreadStatus, number>;

/** Сколько обращений в каждом статусе (по базе, а не по загруженной странице). */
async function statusCounts(db: ReturnType<typeof serviceDb>): Promise<StatusCounts> {
  const out = { new: 0, in_progress: 0, waiting_seller: 0, resolved: 0 } as StatusCounts;
  for (const status of THREAD_STATUSES) {
    const { count, error } = await db
      .from("platform_threads")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (error) {
      if (isMissingTable(error)) return out;
      throw serverFailure(`[operator] обращения не посчитаны: ${error.message}`);
    }
    out[status] = count ?? 0;
  }
  return out;
}

/**
 * Входящие: без фильтра — незакрытые обращения всех клиентов (непрочитанные и
 * самые давние сверху); фильтр по статусу и метке; счётчики по статусам и
 * метки в работе — для чипов. null — раздел выключен (нет таблиц).
 */
export async function supportInbox(
  filter: InboxFilter = {},
  now = new Date(),
): Promise<{
  week: ResponseSummary;
  rows: InboxRow[];
  resolved: number;
  counts: StatusCounts;
  labels: { label: string; count: number }[];
} | null> {
  const db = serviceDb();
  const threads: ThreadRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from("platform_threads")
      .select(
        "id, bot_id, status, labels, created_at, last_message_at, last_seller_message_at, last_operator_message_at, first_response_at, due_at, seller_unread, operator_unread, rev",
      );
    q = filter.status ? q.eq("status", filter.status) : q.neq("status", "resolved");
    const { data, error } = await q
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
  const counts = await statusCounts(db);
  const used = new Map<string, number>();
  for (const t of threads) for (const l of t.labels ?? []) used.set(l, (used.get(l) ?? 0) + 1);
  const wanted = filter.label?.toLowerCase();
  const directory = await tenantDirectory();
  const names = new Map(directory.map((t) => [t.id, t.name]));
  const plans = new Map(directory.map((t) => [t.id, t.plan]));
  const samples = (await responseSamples(now)) ?? [];
  const rows = threads
    .filter((t) => !wanted || (t.labels ?? []).some((l) => l.toLowerCase() === wanted))
    .map((t) => ({
      threadId: t.id,
      botId: t.bot_id,
      client: names.get(t.bot_id) ?? "—",
      status: t.status as ThreadStatus,
      labels: t.labels ?? [],
      lastMessageAt: t.last_message_at,
      unread: t.operator_unread,
      reply: replyDue(t, plans.get(t.bot_id), now),
    }))
    .sort(
      (a, b) =>
        Number(b.reply?.overdue ?? false) - Number(a.reply?.overdue ?? false) ||
        Number(b.unread > 0) - Number(a.unread > 0) ||
        a.lastMessageAt.localeCompare(b.lastMessageAt) ||
        a.threadId.localeCompare(b.threadId),
    );
  const labels = [...used.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return {
    rows,
    resolved: counts.resolved,
    counts,
    labels,
    week: averageResponse(samples, now, 7),
  };
}

export type OperatorThreadView = {
  client: string;
  status: ThreadStatus | null;
  labels: string[];
  /** Заметка оператора: лежит в таблице, к которой у продавца нет доступа вовсе. */
  note: { text: string; updatedAt: string | null; updatedBy: string | null };
  messages: SupportMessage[];
};

/** Заметка обращения; таблицы или записи нет — пустая. */
async function readNote(threadId: string): Promise<OperatorThreadView["note"]> {
  const { data, error } = await serviceDb()
    .from("platform_thread_notes")
    .select("note, updated_at, updated_by")
    .eq("thread_id", threadId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { text: "", updatedAt: null, updatedBy: null };
    throw serverFailure(`[operator] заметка обращения не прочитана: ${error.message}`);
  }
  return {
    text: data?.note ?? "",
    updatedAt: data?.updated_at ?? null,
    updatedBy: data?.updated_by ?? null,
  };
}

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
    labels: thread?.labels ?? [],
    note: thread ? await readNote(thread.id) : { text: "", updatedAt: null, updatedBy: null },
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

/** Последнее обращение клиента для правки статуса, меток и заметки; нет — отказ человеку. */
async function threadToEdit(botId: string): Promise<ThreadRow> {
  const thread = await latestThread(serviceDb(), botId).catch((e: unknown) => {
    if (e instanceof UserError)
      throw new Error("Раздел поддержки ещё не включён: миграция 19-1 не применена.");
    throw e;
  });
  if (!thread) throw new Error("У клиента ещё нет обращений.");
  return thread;
}

/**
 * Статус обращения вручную («новое / в работе / ждёт продавца / решено»).
 * Запись условна по версии; в журнал клиента идёт один раз, от какого к
 * какому статусу и кто сменил. Тот же статус — ничего не пишем.
 */
export async function setThreadStatus(
  botId: string,
  status: ThreadStatus,
  operator: string,
): Promise<{ status: ThreadStatus; changed: boolean }> {
  const thread = await threadToEdit(botId);
  let from: ThreadStatus = thread.status as ThreadStatus;
  const written = await writeThread(serviceDb(), thread.id, (t) => {
    from = t.status as ThreadStatus;
    return t.status === status ? null : { status };
  });
  if (!written) throw new Error("Обращение не найдено.");
  const changed = from !== status;
  if (changed)
    await logEvent(
      botId,
      "message",
      { action: "support_status", thread_id: thread.id, from, to: status },
      operator,
    );
  return { status, changed };
}

/** Метки обращения целиком: пустые и повторы убираются, лимиты из core/support. */
export async function setThreadLabels(
  botId: string,
  labels: string[],
  operator: string,
): Promise<{ labels: string[] }> {
  const clean = cleanLabels(labels);
  const thread = await threadToEdit(botId);
  let before: string[] = thread.labels ?? [];
  const written = await writeThread(serviceDb(), thread.id, (t) => {
    before = t.labels ?? [];
    return JSON.stringify(before) === JSON.stringify(clean) ? null : { labels: clean };
  });
  if (!written) throw new Error("Обращение не найдено.");
  if (JSON.stringify(before) !== JSON.stringify(clean))
    await logEvent(
      botId,
      "message",
      { action: "support_labels", thread_id: thread.id, from: before, to: clean },
      operator,
    );
  return { labels: clean };
}

/**
 * Заметка оператора. Пишется только служебным ключом в таблицу, на которую у
 * продавца нет ни прав, ни политик (миграция 19-1). Два оператора не затрут
 * друг друга: запись условна по времени прежней версии заметки. В журнал
 * идёт факт и длина, а не текст.
 */
export async function saveThreadNote(
  botId: string,
  input: { note: string; expectedAt: string | null },
  operator: string,
): Promise<{ updatedAt: string }> {
  const text = input.note.replace(/\r\n/g, "\n").trim();
  if (text.length > SUPPORT_NOTE_MAX)
    throw new Error(`Заметка длиннее ${SUPPORT_NOTE_MAX} знаков — сократите её.`);
  const thread = await threadToEdit(botId);
  const db = serviceDb();
  const now = new Date().toISOString();
  const stale = new Error("Заметку уже изменили: обновите страницу и повторите.");
  if (input.expectedAt === null) {
    const { error } = await db
      .from("platform_thread_notes")
      .insert({ thread_id: thread.id, note: text, updated_at: now, updated_by: operator });
    if (error) {
      if (error.code === "23505") throw stale;
      throw serverFailure(`[operator] заметка не записана: ${error.message}`);
    }
  } else {
    const { data, error } = await db
      .from("platform_thread_notes")
      .update({ note: text, updated_at: now, updated_by: operator })
      .eq("thread_id", thread.id)
      .eq("updated_at", input.expectedAt)
      .select("thread_id");
    if (error) throw serverFailure(`[operator] заметка не записана: ${error.message}`);
    if (!data?.length) throw stale;
  }
  await logEvent(
    botId,
    "message",
    { action: "support_note", thread_id: thread.id, length: text.length },
    operator,
  );
  return { updatedAt: now };
}
