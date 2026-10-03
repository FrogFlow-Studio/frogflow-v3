import type { Json } from "@/core/db-types";
import { pageAll } from "@/core/db/page";
import { updateSettingAtomic } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Мини-helpdesk (модуль helpdesk, требует manager_chat): обращение
 * покупателя — тикет со статусом, ответственным и историей. Переписка —
 * тот же чат с менеджером; тикет — надстройка для учёта. Своей таблицы нет:
 * строки в `zernio_logs` (`event_id = ticket:<uuid>`, `event_type = ticket`,
 * `status = open|waiting|closed`), всё остальное — в payload.
 *
 * «Ждём покупателя» хранится как `waiting`, а не `pending`: крон добора v1
 * (zernio-retry) помечает «обработанными» все строки `pending` своего бота,
 * и у клиента, чей деплой v1 ещё работает, обращения пропадали бы из списка.
 * Старое `pending` читается как `waiting`.
 */
export const TICKET_PREFIX = "ticket:";
export const TICKET_STATUSES = ["open", "waiting", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
/** Незакрытые — как они лежат в базе, включая старое `pending`. */
export const OPEN_TICKET_DB_STATUSES = ["open", "waiting", "pending"] as const;
/** Сквозной номер обращений магазина: не повторяется, даже когда старые строки удалит чистка журналов. */
export const TICKET_SEQ_KEY = "helpdesk_seq";

function statusFromDb(s: string): TicketStatus {
  if (s === "pending") return "waiting";
  return (TICKET_STATUSES as readonly string[]).includes(s) ? (s as TicketStatus) : "open";
}

export type TicketHistory = { at: string; actor: string; action: string; note?: string };

export type Ticket = {
  id: string;
  number: number;
  status: TicketStatus;
  telegramId: number;
  customerName: string | null;
  platform: string;
  subject: string;
  assignee: string | null;
  createdAt: string;
  history: TicketHistory[];
  /** Оценка покупателя 1–5 после закрытия; null — не ставил. */
  rating: number | null;
  ratedAt: string | null;
  /** Когда покупателю отправили просьбу об оценке (окно ответа цифрой в Direct/WhatsApp). */
  ratingAskedAt: string | null;
};

type Payload = {
  number: number;
  telegram_id: number;
  customer_name: string | null;
  platform: string;
  subject: string;
  assignee: string | null;
  history: TicketHistory[];
  rating?: number | null;
  rated_at?: string | null;
  rating_asked_at?: string | null;
};

function rowToTicket(r: { id: string; status: string; payload: Json; created_at: string }): Ticket {
  const p = (r.payload ?? {}) as unknown as Partial<Payload>;
  return {
    id: r.id,
    number: Number(p.number ?? 0),
    status: statusFromDb(r.status),
    telegramId: Number(p.telegram_id ?? 0),
    customerName: p.customer_name ?? null,
    platform: p.platform ?? "telegram",
    subject: p.subject ?? "",
    assignee: p.assignee ?? null,
    createdAt: r.created_at,
    history: Array.isArray(p.history) ? p.history : [],
    rating: validRating(p.rating) ? Number(p.rating) : null,
    ratedAt: p.rated_at ?? null,
    ratingAskedAt: p.rating_asked_at ?? null,
  };
}

const SELECT = "id, status, payload, created_at";

/** Для заданий: строки журнала → обращения. */
export function rowToTicketForJobs(
  rows: { id: string; status: string; payload: Json; created_at: string }[],
): Ticket[] {
  return rows.map(rowToTicket);
}

function toPayload(t: Ticket): Json {
  return {
    number: t.number,
    telegram_id: t.telegramId,
    customer_name: t.customerName,
    platform: t.platform,
    subject: t.subject,
    assignee: t.assignee,
    history: t.history.slice(-50),
    rating: t.rating,
    rated_at: t.ratedAt,
    rating_asked_at: t.ratingAskedAt,
  } as unknown as Json;
}

export async function openTicketFor(
  ctx: TenantContext,
  telegramId: number,
): Promise<Ticket | null> {
  const { data, error: dataError } = await ctx.db
    .from("zernio_logs")
    .select(SELECT)
    .like("event_id", `${TICKET_PREFIX}%`)
    .in("status", [...OPEN_TICKET_DB_STATUSES])
    .contains("payload", { telegram_id: telegramId })
    .order("created_at", { ascending: false })
    .limit(1);
  if (dataError) throw serverFailure(`Поддержка: ${dataError.message}`);
  return data?.[0] ? rowToTicket(data[0]) : null;
}

/** Новое обращение; если открытое уже есть — дописываем в его историю. */
export async function createTicket(
  ctx: TenantContext,
  input: { telegramId: number; customerName: string | null; platform: string; subject: string },
): Promise<{ ticket: Ticket; created: boolean }> {
  const existing = await openTicketFor(ctx, input.telegramId);
  const now = new Date().toISOString();
  if (existing) {
    const next = {
      ...existing,
      status: "open" as const,
      history: [
        ...existing.history,
        { at: now, actor: "customer", action: "message", note: input.subject.slice(0, 300) },
      ],
    };
    const { error } = await ctx.db
      .from("zernio_logs")
      .update({ status: "open", payload: toPayload(next) })
      .eq("id", existing.id);
    // Не записали — не говорим покупателю, что обращение дополнено.
    if (error) throw serverFailure(`Поддержка: ${error.message}`);
    return { ticket: next, created: false };
  }
  const number = await nextTicketNumber(ctx);
  const ticket: Ticket = {
    id: "",
    number,
    status: "open",
    telegramId: input.telegramId,
    customerName: input.customerName,
    platform: input.platform,
    subject: input.subject.trim().slice(0, 300),
    assignee: null,
    createdAt: now,
    history: [{ at: now, actor: "customer", action: "opened" }],
    rating: null,
    ratedAt: null,
    ratingAskedAt: null,
  };
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .insert({
      bot_id: ctx.tenant.id,
      event_id: `${TICKET_PREFIX}${crypto.randomUUID()}`,
      event_type: "ticket",
      status: "open",
      payload: toPayload(ticket),
    })
    .select("id")
    .single();
  if (error || !data) throw serverFailure(`тикет не создан: ${error?.message}`);
  return { ticket: { ...ticket, id: data.id }, created: true };
}

/**
 * Следующий номер обращения. Раньше номер был «число строк + 1»: чистка
 * журналов удаляет старые строки, и номера пошли бы по второму кругу, а два
 * одновременных обращения получали один номер. Теперь — атомарный счётчик в
 * app_settings; при первом запуске он продолжает самый большой из уже
 * выданных номеров.
 */
export async function nextTicketNumber(ctx: TenantContext): Promise<number> {
  const { data: last, error: lastError } = await ctx.db
    .from("zernio_logs")
    .select("payload")
    .like("event_id", `${TICKET_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (lastError) throw serverFailure(`Поддержка: ${lastError.message}`);
  const seen = Number((last?.[0]?.payload as { number?: unknown } | null)?.number ?? 0) || 0;
  let n = 0;
  const r = await updateSettingAtomic(ctx, TICKET_SEQ_KEY, (raw) => {
    n = Math.max(Number(raw) || 0, seen) + 1;
    return String(n);
  });
  if (r !== "written") throw new Error("номер обращения не выдан: счётчик занят");
  return n;
}

export async function listTickets(
  ctx: TenantContext,
  status?: TicketStatus | null,
  limit = 200,
): Promise<Ticket[]> {
  let q = ctx.db
    .from("zernio_logs")
    .select(SELECT)
    .like("event_id", `${TICKET_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status === "waiting") q = q.in("status", ["waiting", "pending"]);
  else if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToTicket);
}

export async function getTicket(ctx: TenantContext, id: string): Promise<Ticket | null> {
  const { data, error: dataError } = await ctx.db
    .from("zernio_logs")
    .select(SELECT)
    .eq("id", id)
    .like("event_id", `${TICKET_PREFIX}%`)
    .maybeSingle();
  if (dataError) throw serverFailure(`Поддержка: ${dataError.message}`);
  return data ? rowToTicket(data) : null;
}

/** Смена статуса, ответственного или заметка — с записью в историю. */
export async function updateTicket(
  ctx: TenantContext,
  id: string,
  patch: { status?: TicketStatus; assignee?: string | null; note?: string },
  actor: string,
): Promise<Ticket | null> {
  const t = await getTicket(ctx, id);
  if (!t) return null;
  const at = new Date().toISOString();
  const history = [...t.history];
  if (patch.status && patch.status !== t.status)
    history.push({ at, actor, action: `status:${patch.status}` });
  if (patch.assignee !== undefined && patch.assignee !== t.assignee)
    history.push({ at, actor, action: `assignee:${patch.assignee ?? "-"}` });
  if (patch.note?.trim())
    history.push({ at, actor, action: "note", note: patch.note.trim().slice(0, 1000) });
  const next: Ticket = {
    ...t,
    status: patch.status ?? t.status,
    assignee: patch.assignee !== undefined ? patch.assignee : t.assignee,
    history,
  };
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({ status: next.status, payload: toPayload(next) })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return next;
}

export async function countOpenTickets(ctx: TenantContext): Promise<number> {
  const { count, error: countError } = await ctx.db
    .from("zernio_logs")
    .select("id", { count: "exact", head: true })
    .like("event_id", `${TICKET_PREFIX}%`)
    .eq("status", "open");
  if (countError) throw serverFailure(`Поддержка: ${countError.message}`);
  return count ?? 0;
}

// ── Оценка работы поддержки ────────────────────────────────────────────

export const RATING_ASK_WINDOW_MS = 7 * 24 * 3600 * 1000;
/** Оценки не выше этого числа — «низкие»: попадают в верх страницы «Обращения». */
export const LOW_RATING_MAX = 2;
/** Отметка «оценка поставлена»: вставка с уникальным ключом — выигрывает одна. */
export const ratingMarkKey = (ticketId: string) => `ticket_rating:${ticketId}`;

export function validRating(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

/** Покупателю ушла просьба об оценке — запоминаем момент (для ответа цифрой в Direct/WhatsApp). */
export async function markRatingAsked(ctx: TenantContext, ticketId: string): Promise<void> {
  const t = await getTicket(ctx, ticketId);
  if (!t || t.rating !== null) return;
  const next: Ticket = { ...t, ratingAskedAt: new Date().toISOString() };
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({ payload: toPayload(next) })
    .eq("id", ticketId);
  if (error) throw serverFailure(`Поддержка: ${error.message}`);
}

/** Покупатель написал что-то другое — просьба об оценке больше не ждёт цифры. */
export async function clearRatingAsked(ctx: TenantContext, ticketId: string): Promise<void> {
  const t = await getTicket(ctx, ticketId);
  if (!t || t.ratingAskedAt === null) return;
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({ payload: toPayload({ ...t, ratingAskedAt: null }) })
    .eq("id", ticketId);
  if (error) throw serverFailure(`Поддержка: ${error.message}`);
}

export type RateResult = "rated" | "already" | "invalid";

/**
 * Оценка закрытого обращения. Один раз: сначала занимается отметка
 * (`app_settings`, уникальный ключ), потом оценка пишется в обращение.
 * Повторное нажатие кнопки или вторая цифра — «already», оценка не меняется.
 * Чужое обращение или не закрытое — «invalid».
 */
export async function rateTicket(
  ctx: TenantContext,
  ticketId: string,
  telegramId: number,
  score: number,
): Promise<RateResult> {
  if (!validRating(score)) return "invalid";
  const t = await getTicket(ctx, ticketId);
  if (!t || t.telegramId !== telegramId || t.status !== "closed") return "invalid";
  if (t.rating !== null) return "already";
  const key = ratingMarkKey(ticketId);
  const { error: markError } = await ctx.db
    .from("app_settings")
    .insert({ bot_id: ctx.tenant.id, key, value: String(score) });
  if (markError) {
    if (markError.code === "23505") return "already";
    throw serverFailure(`Поддержка: оценка не записана: ${markError.message}`);
  }
  const now = new Date().toISOString();
  const next: Ticket = {
    ...t,
    rating: score,
    ratedAt: now,
    history: [...t.history, { at: now, actor: "customer", action: `rating:${score}` }],
  };
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({ payload: toPayload(next) })
    .eq("id", ticketId);
  if (error) {
    // Оценка не легла в обращение — снимаем отметку, чтобы покупатель мог повторить.
    await ctx.db.from("app_settings").delete().eq("bot_id", ctx.tenant.id).eq("key", key);
    throw serverFailure(`Поддержка: оценка не записана: ${error.message}`);
  }
  return "rated";
}

/** Закрытое обращение покупателя, по которому недавно просили оценку и ответа ещё нет. */
export async function ticketAwaitingRating(
  ctx: TenantContext,
  telegramId: number,
  now = new Date(),
): Promise<Ticket | null> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select(SELECT)
        .like("event_id", `${TICKET_PREFIX}%`)
        .eq("status", "closed")
        .contains("payload", { telegram_id: telegramId })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    "Поддержка: обращения покупателя",
  );
  let best: Ticket | null = null;
  for (const r of rows) {
    const t = rowToTicket(r);
    if (t.rating !== null || !t.ratingAskedAt) continue;
    const asked = Date.parse(t.ratingAskedAt);
    if (!(now.getTime() - asked <= RATING_ASK_WINDOW_MS)) continue;
    if (!best || asked > Date.parse(best.ratingAskedAt!)) best = t;
  }
  return best;
}

export type RatingStats = {
  count: number;
  average: number | null;
  low: Ticket[];
  lowCount: number;
};

/** Средняя оценка магазина и обращения с низкими оценками (свежие первыми, не больше `lowShown`). */
export async function ratingStats(ctx: TenantContext, lowShown = 10): Promise<RatingStats> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select(SELECT)
        .like("event_id", `${TICKET_PREFIX}%`)
        .eq("status", "closed")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    "Поддержка: оценки",
  );
  const rated = rows.map(rowToTicket).filter((t) => t.rating !== null);
  const sum = rated.reduce((a, t) => a + (t.rating ?? 0), 0);
  const low = rated.filter((t) => (t.rating ?? 5) <= LOW_RATING_MAX);
  return {
    count: rated.length,
    average: rated.length ? Math.round((sum / rated.length) * 10) / 10 : null,
    low: low.slice(0, lowShown),
    lowCount: low.length,
  };
}
