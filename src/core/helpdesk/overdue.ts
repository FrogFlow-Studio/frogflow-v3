import { pageAll } from "@/core/db/page";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { type Ticket, TICKET_PREFIX, rowToTicketForJobs } from "./tickets";

/**
 * Просроченные обращения. Обращение просрочено, если оно «Открыто» (не «Ждём
 * покупателя» и не закрыто), покупатель написал последним — в обращении
 * (открыл или дописал) — и продавец с тех пор не ответил в «Чате» дольше N
 * часов. N — на странице «Обращения», по умолчанию выключено. На один такой
 * отрезок ожидания — одно напоминание продавцу: отметка ставится условной
 * вставкой до отправки, ключ — обращение и момент последнего слова покупателя
 * (новый вопрос покупателя открывает новый отрезок).
 */
export const OVERDUE_KEY = "helpdesk_overdue_hours";
export const OVERDUE_OPTIONS = [0, 1, 2, 4, 8, 24] as const;
/** Старше этого — уже не «напомнить»: при включении не заваливаем старьём. */
export const OVERDUE_MAX_AGE_MS = 7 * 86_400_000;
/** Напоминаний за один проход крона; остальные — следующим проходом. */
export const OVERDUE_BATCH = 50;
export const OVERDUE_EVENT_TYPE = "ticket.overdue";

export function parseOverdueHours(raw: string | null | undefined): number {
  const n = Number(raw);
  return (OVERDUE_OPTIONS as readonly number[]).includes(n) ? n : 0;
}

/** Когда покупатель в последний раз написал в обращении; null — записей покупателя нет. */
export function customerWaitingSince(t: Pick<Ticket, "history" | "createdAt">): string | null {
  for (let i = t.history.length - 1; i >= 0; i--) {
    const h = t.history[i]!;
    if (h.actor === "customer" && (h.action === "opened" || h.action === "message")) return h.at;
  }
  return null;
}

export type OverdueTicket = { ticket: Ticket; waitingSince: string; claimKey: string };

async function managerRepliedSince(
  ctx: TenantContext,
  telegramId: number,
  since: string,
): Promise<boolean> {
  // Нужен лишь факт «был ответ» — одна строка, не выборка.
  const { data, error } = await ctx.db
    .from("manager_chat_messages")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("sender", "manager")
    .gt("created_at", since)
    .order("id")
    .limit(1);
  if (error) throw serverFailure(`Просроченные обращения: ответ продавца: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Из списка — те, что просрочены на `hours` часов. Для крона и подсветки в списке. */
export async function overdueAmong(
  ctx: TenantContext,
  tickets: readonly Ticket[],
  hours: number,
  now = new Date(),
): Promise<OverdueTicket[]> {
  if (!hours) return [];
  const due = now.getTime() - hours * 3_600_000;
  const out: OverdueTicket[] = [];
  for (const ticket of tickets) {
    if (ticket.status !== "open") continue;
    const since = customerWaitingSince(ticket);
    if (!since || Date.parse(since) > due) continue;
    if (await managerRepliedSince(ctx, ticket.telegramId, since)) continue;
    out.push({ ticket, waitingSince: since, claimKey: `${ticket.id}:${since}` });
  }
  return out;
}

/** Все «Открытые» обращения магазина постранично; свежие не старше OVERDUE_MAX_AGE_MS. */
async function openTicketsForReminder(ctx: TenantContext, now: Date): Promise<Ticket[]> {
  const oldest = new Date(now.getTime() - OVERDUE_MAX_AGE_MS).toISOString();
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, status, payload, created_at")
        .like("event_id", `${TICKET_PREFIX}%`)
        .eq("status", "open")
        .order("id")
        .range(from, to),
    "Просроченные обращения: открытые",
  );
  return rowToTicketForJobs(rows).filter((t) => {
    const since = customerWaitingSince(t);
    return since !== null && since >= oldest;
  });
}

/** Отметка «напомнили» — до отправки; true — поставил этот вызов (повтор ключа 23505 — занято). */
export async function claimOverdue(ctx: TenantContext, claimKey: string): Promise<boolean> {
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: `overdue:${ctx.tenant.id}:${claimKey}`,
    event_type: OVERDUE_EVENT_TYPE,
    status: "processed",
    payload: { key: claimKey },
  });
  if (error && error.code !== "23505")
    console.warn(`[helpdesk] напоминание ${claimKey} не отмечено: ${error.message}`);
  return !error;
}

export type OverdueNotifier = (o: OverdueTicket) => Promise<unknown>;

/** Один проход: найти просроченные, отметить и напомнить по каждому один раз. */
export async function remindOverdue(
  ctx: TenantContext,
  hours: number,
  notify: OverdueNotifier,
  now = new Date(),
): Promise<{ overdue: number; reminded: number }> {
  if (!hours) return { overdue: 0, reminded: 0 };
  const list = (await overdueAmong(ctx, await openTicketsForReminder(ctx, now), hours, now)).slice(
    0,
    OVERDUE_BATCH,
  );
  let reminded = 0;
  for (const o of list) {
    if (!(await claimOverdue(ctx, o.claimKey))) continue;
    await notify(o);
    reminded++;
  }
  return { overdue: list.length, reminded };
}
