import type { Database } from "@/core/db-types";
import type { Db } from "@/core/db/client.server";
import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Чат продавца с платформой (поддержка в админке). Таблицы `platform_threads`
 * и `platform_messages` заведены миграцией 19-1; пока Яков её не применил,
 * раздел выключен: чтение отдаёт `available: false`, отправка — понятный отказ
 * «скоро», без падений.
 *
 * Разговор у магазина один сквозной; «обращение» (thread) — его отрезок со
 * статусом. Незакрытое обращение у магазина не больше одного (уникальный
 * индекс), новое сообщение продавца после «решено» открывает следующее.
 *
 * Счётчики и статус меняются условной записью по `rev` (маленькое поле):
 * два сообщения подряд или ответ оператора одновременно с сообщением
 * продавца не затирают друг друга — повторяем от свежего состояния.
 */
type Tables = Database["public"]["Tables"];
export type ThreadRow = Tables["platform_threads"]["Row"];
export type MessageRow = Tables["platform_messages"]["Row"];
type ThreadPatch = Tables["platform_threads"]["Update"];

export const THREAD_STATUSES = ["new", "in_progress", "waiting_seller", "resolved"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export const SUPPORT_BODY_MAX = 4000;
/** Метки оператора (Ч9): быстрые варианты, до пяти на обращение, до 30 знаков каждая. */
export const SUPPORT_LABEL_PRESETS = ["оплата", "Instagram", "ошибка"] as const;
export const SUPPORT_LABELS_MAX = 5;
export const SUPPORT_LABEL_MAX_LEN = 30;
export const SUPPORT_NOTE_MAX = 4000;
export const STATUS_LABEL_RU: Record<ThreadStatus, string> = {
  new: "новое",
  in_progress: "в работе",
  waiting_seller: "ждёт продавца",
  resolved: "решено",
};
const WRITE_TRIES = 4;
const PAGE = 1000;

export type SupportMessage = {
  id: string;
  author: "seller" | "operator";
  authorName: string | null;
  body: string;
  createdAt: string;
  /** Прочитала ли другая сторона. */
  read: boolean;
};

export type SupportView =
  | { available: false }
  | {
      available: true;
      status: ThreadStatus | null;
      /** Ответов оператора, которых продавец ещё не видел. */
      unread: number;
      messages: SupportMessage[];
    };

/** Таблицы нет (миграция не применена): PostgREST отвечает PGRST205, Postgres — 42P01. */
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}

export const supportSoon = () =>
  new UserError("err.support.soon", "Чат с поддержкой скоро заработает: раздел ещё не включён.");

export function toSupportMessage(r: MessageRow): SupportMessage {
  return {
    id: r.id,
    author: r.author === "operator" ? "operator" : "seller",
    authorName: r.author_name,
    body: r.body,
    createdAt: r.created_at,
    read: r.read_at != null,
  };
}

/** Метки из ввода оператора: без пустых и повторов (без учёта регистра), в пределах лимитов. */
export function cleanLabels(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const label = r.replace(/\s+/g, " ").trim();
    if (!label) continue;
    if (label.length > SUPPORT_LABEL_MAX_LEN)
      throw new Error(`Метка «${label.slice(0, 12)}…» длиннее ${SUPPORT_LABEL_MAX_LEN} знаков.`);
    if (!out.some((x) => x.toLowerCase() === label.toLowerCase())) out.push(label);
  }
  if (out.length > SUPPORT_LABELS_MAX)
    throw new Error(`Меток не больше ${SUPPORT_LABELS_MAX} на обращение.`);
  return out;
}

export function cleanBody(raw: string): string {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (!body)
    throw new UserError("err.support.empty", "Напишите сообщение: пустое отправить нельзя.");
  if (body.length > SUPPORT_BODY_MAX)
    throw new UserError("err.support.tooLong", "Сообщение длиннее {max} знаков — сократите его.", {
      max: SUPPORT_BODY_MAX,
    });
  return body;
}

const THREAD_COLS =
  "id, bot_id, status, labels, created_at, last_message_at, last_seller_message_at, last_operator_message_at, first_response_at, due_at, seller_unread, operator_unread, rev";
export const MESSAGE_COLS =
  "id, bot_id, thread_id, author, author_name, body, attachment_key, context, created_at, read_at, notified_at";

/** Все сообщения магазина постранично (по возрастанию, ключ сортировки — id); null — таблицы нет. */
export async function readMessages(db: Db, botId: string): Promise<MessageRow[] | null> {
  const out: MessageRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("platform_messages")
      .select(MESSAGE_COLS)
      .eq("bot_id", botId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw serverFailure(`Поддержка: сообщения не прочитаны: ${error.message}`);
    }
    const rows = (data ?? []) as MessageRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Последнее обращение магазина (открытое или закрытое); null — не было. */
export async function latestThread(db: Db, botId: string): Promise<ThreadRow | null> {
  const { data, error } = await db
    .from("platform_threads")
    .select(THREAD_COLS)
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingTable(error)) throw supportSoon();
    throw serverFailure(`Поддержка: ${error.message}`);
  }
  return (data?.[0] as ThreadRow | undefined) ?? null;
}

/** Незакрытое обращение магазина (по уникальному индексу их не больше одного). */
export async function openThread(db: Db, botId: string): Promise<ThreadRow | null> {
  const { data, error } = await db
    .from("platform_threads")
    .select(THREAD_COLS)
    .eq("bot_id", botId)
    .neq("status", "resolved")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingTable(error)) throw supportSoon();
    throw serverFailure(`Поддержка: ${error.message}`);
  }
  return (data?.[0] as ThreadRow | undefined) ?? null;
}

/** Обращение со значениями по умолчанию явно: запись не зависит от того, что подставит база. */
export function newThread(botId: string): Tables["platform_threads"]["Insert"] {
  const now = new Date().toISOString();
  return {
    bot_id: botId,
    status: "new",
    labels: [],
    created_at: now,
    last_message_at: now,
    seller_unread: 0,
    operator_unread: 0,
    rev: 0,
  };
}

/** Открытое обращение; нет — заводит. Два одновременных первых сообщения дают одно обращение. */
export async function ensureOpenThread(db: Db, botId: string): Promise<ThreadRow> {
  const found = await openThread(db, botId);
  if (found) return found;
  const { data, error } = await db
    .from("platform_threads")
    .insert(newThread(botId))
    .select(THREAD_COLS)
    .single();
  if (error) {
    if (isMissingTable(error)) throw supportSoon();
    // Уникальный индекс: рядом успели завести то же обращение — берём его.
    if (error.code === "23505") {
      const again = await openThread(db, botId);
      if (again) return again;
    }
    throw serverFailure(`Поддержка: ${error.message}`);
  }
  return data as ThreadRow;
}

/**
 * Пишет обращение условно по версии: `build` получает свежее состояние и
 * возвращает изменения (или null — писать нечего). Версия и счётчики —
 * маленькие поля, весь текст в адрес запроса не попадает.
 */
export async function writeThread(
  db: Db,
  id: string,
  build: (t: ThreadRow) => ThreadPatch | null,
): Promise<ThreadRow | null> {
  for (let attempt = 0; attempt < WRITE_TRIES; attempt++) {
    const { data: row, error: readError } = await db
      .from("platform_threads")
      .select(THREAD_COLS)
      .eq("id", id)
      .maybeSingle();
    if (readError) throw serverFailure(`Поддержка: ${readError.message}`);
    if (!row) return null;
    const cur = row as ThreadRow;
    const patch = build(cur);
    if (!patch) return cur;
    const { data, error } = await db
      .from("platform_threads")
      .update({ ...patch, rev: cur.rev + 1 })
      .eq("id", id)
      .eq("rev", cur.rev)
      .select(THREAD_COLS);
    if (error) throw serverFailure(`Поддержка: ${error.message}`);
    if (data?.length) return data[0] as ThreadRow;
  }
  throw serverFailure("Поддержка: обращение менялось одновременно, запись не прошла");
}

/* ---------- сторона продавца (под ролью арендатора) ---------- */

export async function loadSupport(ctx: TenantContext): Promise<SupportView> {
  const rows = await readMessages(ctx.db, ctx.tenant.id);
  if (rows === null) return { available: false };
  const thread = await latestThread(ctx.db, ctx.tenant.id);
  return {
    available: true,
    status: thread ? (thread.status as ThreadStatus) : null,
    unread: thread?.seller_unread ?? 0,
    messages: rows.map(toSupportMessage),
  };
}

/** Сообщение продавца: обращение открывается само, оператор видит новое непрочитанное. */
export async function sendSellerMessage(
  ctx: TenantContext,
  input: { body: string; authorName: string },
): Promise<{ message: SupportMessage; thread: ThreadRow }> {
  const body = cleanBody(input.body);
  const botId = ctx.tenant.id;
  const thread = await ensureOpenThread(ctx.db, botId);
  const { data, error } = await ctx.db
    .from("platform_messages")
    .insert({
      bot_id: botId,
      thread_id: thread.id,
      author: "seller",
      author_name: input.authorName.slice(0, 80) || null,
      body,
      created_at: new Date().toISOString(),
      read_at: null,
      notified_at: null,
    })
    .select(MESSAGE_COLS)
    .single();
  if (error) throw serverFailure(`Поддержка: сообщение не записано: ${error.message}`);
  const now = new Date().toISOString();
  const updated = await writeThread(ctx.db, thread.id, (t) => ({
    last_message_at: now,
    last_seller_message_at: now,
    operator_unread: t.operator_unread + 1,
    // Продавец ответил на вопрос оператора — снова «в работе».
    ...(t.status === "waiting_seller" ? { status: "in_progress" } : {}),
  }));
  return { message: toSupportMessage(data as MessageRow), thread: updated ?? thread };
}

/** Продавец открыл чат: ответы оператора прочитаны, счётчик в меню гаснет. */
export async function markSellerRead(ctx: TenantContext): Promise<void> {
  const botId = ctx.tenant.id;
  let thread: ThreadRow | null;
  try {
    thread = await latestThread(ctx.db, botId);
  } catch (e) {
    if (e instanceof UserError) return; // таблицы нет — читать нечего
    throw e;
  }
  if (!thread) return;
  if (thread.seller_unread > 0)
    await writeThread(ctx.db, thread.id, (t) =>
      t.seller_unread > 0 ? { seller_unread: 0 } : null,
    );
  const { error } = await ctx.db
    .from("platform_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("bot_id", botId)
    .eq("author", "operator")
    .is("read_at", null);
  if (error) throw serverFailure(`Поддержка: ${error.message}`);
}

/** Сколько ответов оператора продавец ещё не читал (счётчик в меню); 0 — и когда раздел выключен. */
export async function supportUnread(ctx: TenantContext): Promise<number> {
  try {
    return (await latestThread(ctx.db, ctx.tenant.id))?.seller_unread ?? 0;
  } catch (e) {
    if (e instanceof UserError) return 0;
    throw e;
  }
}
