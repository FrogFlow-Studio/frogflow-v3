import type { Json } from "@/core/db-types";
import { updateSettingAtomic } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";

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
};

type Payload = {
  number: number;
  telegram_id: number;
  customer_name: string | null;
  platform: string;
  subject: string;
  assignee: string | null;
  history: TicketHistory[];
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
  };
}

const SELECT = "id, status, payload, created_at";

function toPayload(t: Ticket): Json {
  return {
    number: t.number,
    telegram_id: t.telegramId,
    customer_name: t.customerName,
    platform: t.platform,
    subject: t.subject,
    assignee: t.assignee,
    history: t.history.slice(-50),
  } as unknown as Json;
}

export async function openTicketFor(
  ctx: TenantContext,
  telegramId: number,
): Promise<Ticket | null> {
  const { data } = await ctx.db
    .from("zernio_logs")
    .select(SELECT)
    .like("event_id", `${TICKET_PREFIX}%`)
    .in("status", [...OPEN_TICKET_DB_STATUSES])
    .contains("payload", { telegram_id: telegramId })
    .order("created_at", { ascending: false })
    .limit(1);
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
    await ctx.db
      .from("zernio_logs")
      .update({ status: "open", payload: toPayload(next) })
      .eq("id", existing.id);
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
  if (error || !data) throw new Error(`тикет не создан: ${error?.message}`);
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
  const { data: last } = await ctx.db
    .from("zernio_logs")
    .select("payload")
    .like("event_id", `${TICKET_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1);
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
  const { data } = await ctx.db
    .from("zernio_logs")
    .select(SELECT)
    .eq("id", id)
    .like("event_id", `${TICKET_PREFIX}%`)
    .maybeSingle();
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
  const { count } = await ctx.db
    .from("zernio_logs")
    .select("id", { count: "exact", head: true })
    .like("event_id", `${TICKET_PREFIX}%`)
    .eq("status", "open");
  return count ?? 0;
}
