import type { TenantContext } from "@/core/tenant/resolve.server";
import { INBOX_EVENT_TYPE, rowToMeta } from "@/core/inbox/inbox";
import { OPEN_TICKET_DB_STATUSES, TICKET_PREFIX } from "@/core/helpdesk/tickets";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";

/**
 * Напоминание продавцу о диалоге без ответа. Ждущим считается диалог, где
 * отвечать должен человек: продавец подключён (бот молчит, в том числе
 * после передачи от ИИ-консультанта), у диалога есть ответственный или
 * открытое обращение «Поддержки». И последнее слово в нём — за покупателем
 * (ответы бота не в счёт) дольше N минут. На один такой отрезок ожидания —
 * одно напоминание: отметка ставится условной записью до отправки, ключ —
 * последний ответ продавца (новые реплики покупателя ключ не меняют, новый
 * ответ продавца открывает новый отрезок).
 * N — на странице «Чат», по умолчанию выключено.
 */
export const UNANSWERED_KEY = "chat_unanswered_minutes";
export const UNANSWERED_OPTIONS = [0, 15, 30, 60, 120, 240] as const;
/** Ожидание дольше этого — уже не «напомнить»: при включении не заваливаем старьём. */
export const UNANSWERED_MAX_AGE_MS = 3 * 86_400_000;
/** Напоминаний за один проход крона; остальные — следующим проходом. */
export const UNANSWERED_BATCH = 100;
export const UNANSWERED_EVENT_TYPE = "chat.unanswered";
/** Второй шаг — владельцу магазина: «если ответственный молчит, диалог не висит». Включается отдельно. */
export const UNANSWERED_ESCALATE_KEY = "chat_unanswered_escalate";
export const UNANSWERED_ESCALATION_EVENT_TYPE = "chat.unanswered.escalated";

export function parseEscalate(raw: string | null | undefined): boolean {
  return raw === "1";
}

export function parseUnansweredMinutes(raw: string | null | undefined): number {
  const n = Number(raw);
  return (UNANSWERED_OPTIONS as readonly number[]).includes(n) ? n : 0;
}

export type UnansweredDialog = {
  telegramId: number;
  /** Первая реплика покупателя после последнего ответа продавца (в пределах трёх суток). */
  waitingSince: string;
  lastText: string;
  assignee: string | null;
};

type Row<T> = { data: T | null; error: { message: string } | null };
function must<T>(r: Row<T>, what: string): T | null {
  if (r.error) throw serverFailure(`напоминание о диалогах: ${what}: ${r.error.message}`);
  return r.data;
}

/**
 * Диалоги, где ждут человека: подключён продавец, есть ответственный или
 * открытое обращение; решённые — нет. Всё постранично, с уникальным ключом
 * в сортировке: у большого магазина строк больше тысячи.
 */
async function humanDialogs(ctx: TenantContext): Promise<Map<number, string | null>> {
  const [active, inbox, tickets] = await Promise.all([
    pageAll(
      (from, to) =>
        ctx.db
          .from("manager_chat_state")
          .select("telegram_id")
          .eq("active", true)
          .order("telegram_id")
          .range(from, to),
      "напоминание о диалогах: подключённые",
    ),
    pageAll(
      (from, to) =>
        ctx.db
          .from("zernio_logs")
          .select("id, status, payload")
          .eq("event_type", INBOX_EVENT_TYPE)
          .order("id")
          .range(from, to),
      "напоминание о диалогах: учёт входящих",
    ),
    pageAll(
      (from, to) =>
        ctx.db
          .from("zernio_logs")
          .select("id, payload")
          .like("event_id", `${TICKET_PREFIX}%`)
          .in("status", [...OPEN_TICKET_DB_STATUSES])
          .order("id")
          .range(from, to),
      "напоминание о диалогах: обращения",
    ),
  ]);
  const closed = new Set<number>();
  const assignee = new Map<number, string>();
  for (const row of inbox) {
    const m = rowToMeta(row);
    if (!m.telegramId) continue;
    if (m.status === "closed") closed.add(m.telegramId);
    else if (m.assignee) assignee.set(m.telegramId, m.assignee);
  }
  const out = new Map<number, string | null>();
  const add = (id: number) => {
    if (id && !closed.has(id)) out.set(id, assignee.get(id) ?? null);
  };
  for (const r of active) add(Number(r.telegram_id));
  for (const id of assignee.keys()) add(id);
  for (const r of tickets)
    add(Number((r.payload as { telegram_id?: number } | null)?.telegram_id ?? 0));
  return out;
}

/** Ключ отрезка ожидания: id последнего ответа продавца или «none», если он не отвечал. */
async function lastManagerReply(
  ctx: TenantContext,
  telegramId: number,
): Promise<{ id: string; at: string } | null> {
  const rows = must(
    await ctx.db
      .from("manager_chat_messages")
      .select("id, created_at")
      .eq("telegram_id", telegramId)
      .eq("sender", "manager")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1),
    "ответ продавца",
  );
  const r = rows?.[0];
  return r ? { id: r.id, at: r.created_at } : null;
}

/** Первая и последняя реплики покупателя после `after`; null — покупатель не писал. */
async function customerSince(
  ctx: TenantContext,
  telegramId: number,
  after: string,
): Promise<{ first: string; lastText: string } | null> {
  const q = () =>
    ctx.db
      .from("manager_chat_messages")
      .select("id, text, created_at")
      .eq("telegram_id", telegramId)
      .eq("sender", "customer")
      .gt("created_at", after);
  const first = must(
    await q().order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1),
    "реплики покупателя",
  )?.[0];
  if (!first) return null;
  const last = must(
    await q().order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
    "реплики покупателя",
  )?.[0];
  return { first: first.created_at, lastText: (last ?? first).text };
}

/** Уже поставленные отметки за трое суток: диалог → ключи и время последней отметки. */
async function recentClaims(
  ctx: TenantContext,
  since: string,
): Promise<Map<number, { keys: Set<string>; lastAt: string; at: Map<string, string> }>> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, payload, created_at")
        .eq("event_type", UNANSWERED_EVENT_TYPE)
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    "напоминание о диалогах: отметки",
  );
  const out = new Map<number, { keys: Set<string>; lastAt: string; at: Map<string, string> }>();
  for (const r of rows) {
    const p = (r.payload ?? {}) as { telegram_id?: number; key?: string };
    const id = Number(p.telegram_id ?? 0);
    if (!id || !p.key) continue;
    const cur = out.get(id) ?? {
      keys: new Set<string>(),
      lastAt: "",
      at: new Map<string, string>(),
    };
    cur.keys.add(p.key);
    cur.at.set(p.key, r.created_at);
    if (r.created_at > cur.lastAt) cur.lastAt = r.created_at;
    out.set(id, cur);
  }
  return out;
}

/**
 * Кому пора напомнить: ждут дольше `minutes`. Уже напомненные отсеиваются
 * заранее — без запросов по диалогу, если после отметки в нём ничего не было.
 */
export async function findUnanswered(
  ctx: TenantContext,
  minutes: number,
  now = new Date(),
): Promise<Array<UnansweredDialog & { claimKey: string }>> {
  if (!minutes) return [];
  const due = now.getTime() - minutes * 60_000;
  const oldestIso = new Date(now.getTime() - UNANSWERED_MAX_AGE_MS).toISOString();
  const human = await humanDialogs(ctx);
  if (!human.size) return [];
  const claims = await recentClaims(ctx, oldestIso);
  // Где за трое суток вообще что-то было — кусками по 200 id, по возрастанию id.
  const ids = [...human.keys()].sort((a, b) => a - b);
  const recent: Array<{ id: number; lastMessageAt: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const rows = must(
      await ctx.db
        .from("manager_chat_state")
        .select("telegram_id, last_message_at")
        .in("telegram_id", ids.slice(i, i + 200))
        .gte("last_message_at", oldestIso)
        .order("telegram_id"),
      "последние реплики",
    );
    for (const r of rows ?? [])
      recent.push({ id: Number(r.telegram_id), lastMessageAt: r.last_message_at });
  }
  const out: Array<UnansweredDialog & { claimKey: string }> = [];
  for (const { id: telegramId, lastMessageAt } of recent) {
    if (out.length >= UNANSWERED_BATCH) break;
    // Напомнили, и с тех пор в диалоге тихо — тот же отрезок, запросов не нужно.
    const claimed = claims.get(telegramId);
    if (claimed && claimed.lastAt >= lastMessageAt) continue;
    const manager = await lastManagerReply(ctx, telegramId);
    const claimKey = manager ? `after:${manager.id}` : "after:none";
    if (claimed?.keys.has(claimKey)) continue;
    const after = manager && manager.at > oldestIso ? manager.at : oldestIso;
    const waiting = await customerSince(ctx, telegramId, after);
    if (!waiting || !(Date.parse(waiting.first) <= due)) continue;
    out.push({
      telegramId,
      waitingSince: waiting.first,
      lastText: waiting.lastText,
      assignee: human.get(telegramId) ?? null,
      claimKey,
    });
  }
  return out;
}

/**
 * Отметка «уже напомнили» об этом отрезке ожидания — до отправки: уникальный
 * event_id отбивает второй запуск крона. true — отметку поставил этот вызов.
 * Статус processed: чистка журнала уберёт строку через 30 дней.
 */
export async function claimUnanswered(
  ctx: TenantContext,
  telegramId: number,
  claimKey: string,
): Promise<boolean> {
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: `unanswered:${ctx.tenant.id}:${telegramId}:${claimKey}`,
    event_type: UNANSWERED_EVENT_TYPE,
    status: "processed",
    payload: { telegram_id: telegramId, key: claimKey },
  });
  if (error && error.code !== "23505")
    console.warn(`[chat] напоминание о диалоге ${telegramId} не отмечено: ${error.message}`);
  return !error;
}

/** Отметки второго шага за трое суток: «диалог|ключ отрезка». */
async function recentEscalations(ctx: TenantContext, since: string): Promise<Set<string>> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, payload")
        .eq("event_type", UNANSWERED_ESCALATION_EVENT_TYPE)
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    "напоминание о диалогах: отметки второго шага",
  );
  const out = new Set<string>();
  for (const r of rows) {
    const p = (r.payload ?? {}) as { telegram_id?: number; key?: string };
    if (p.telegram_id && p.key) out.add(`${p.telegram_id}|${p.key}`);
  }
  return out;
}

/**
 * Кому пора во второй шаг: первое напоминание отправлено больше `minutes`
 * назад, а продавец так и не ответил (ключ отрезка тот же — новый ответ
 * продавца ключ меняет), покупатель всё ещё ждёт и диалог не закрыт.
 */
export async function findEscalations(
  ctx: TenantContext,
  minutes: number,
  now = new Date(),
): Promise<Array<UnansweredDialog & { claimKey: string }>> {
  if (!minutes) return [];
  const oldestIso = new Date(now.getTime() - UNANSWERED_MAX_AGE_MS).toISOString();
  const claims = await recentClaims(ctx, oldestIso);
  if (!claims.size) return [];
  const human = await humanDialogs(ctx);
  const escalated = await recentEscalations(ctx, oldestIso);
  const out: Array<UnansweredDialog & { claimKey: string }> = [];
  for (const [telegramId, claimed] of [...claims].sort((a, b) => a[0] - b[0])) {
    if (out.length >= UNANSWERED_BATCH) break;
    if (!human.has(telegramId)) continue;
    // Самый свежий отрезок — без запросов отсекаем тех, кому ещё рано.
    const newest = [...claimed.at.values()].sort().at(-1) ?? "";
    if (now.getTime() - Date.parse(newest) < minutes * 60_000) continue;
    const manager = await lastManagerReply(ctx, telegramId);
    const claimKey = manager ? `after:${manager.id}` : "after:none";
    const remindedAt = claimed.at.get(claimKey);
    if (!remindedAt || escalated.has(`${telegramId}|${claimKey}`)) continue;
    if (now.getTime() - Date.parse(remindedAt) < minutes * 60_000) continue;
    const after = manager && manager.at > oldestIso ? manager.at : oldestIso;
    const waiting = await customerSince(ctx, telegramId, after);
    if (!waiting) continue;
    out.push({
      telegramId,
      waitingSince: waiting.first,
      lastText: waiting.lastText,
      assignee: human.get(telegramId) ?? null,
      claimKey,
    });
  }
  return out;
}

/** Отметка второго шага — до отправки, как у первого: true — её поставил этот вызов. */
export async function claimEscalation(
  ctx: TenantContext,
  telegramId: number,
  claimKey: string,
): Promise<boolean> {
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: `unanswered-escalated:${ctx.tenant.id}:${telegramId}:${claimKey}`,
    event_type: UNANSWERED_ESCALATION_EVENT_TYPE,
    status: "processed",
    payload: { telegram_id: telegramId, key: claimKey },
  });
  if (error && error.code !== "23505")
    console.warn(`[chat] второй шаг по диалогу ${telegramId} не отмечен: ${error.message}`);
  return !error;
}

export type UnansweredNotifier = (d: UnansweredDialog) => Promise<unknown>;

/**
 * Один проход: найти ждущие диалоги, отметить и напомнить по каждому один раз.
 * `escalate` (если задан) — второй шаг владельцу: через столько же минут после
 * напоминания, если продавец так и не ответил; тоже один раз на отрезок.
 */
export async function remindUnanswered(
  ctx: TenantContext,
  minutes: number,
  notify: UnansweredNotifier,
  now = new Date(),
  escalate?: UnansweredNotifier,
): Promise<{ waiting: number; reminded: number; escalated: number }> {
  const list = await findUnanswered(ctx, minutes, now);
  let reminded = 0;
  for (const d of list) {
    if (!(await claimUnanswered(ctx, d.telegramId, d.claimKey))) continue;
    await notify(d);
    reminded++;
  }
  let escalated = 0;
  if (escalate) {
    for (const d of await findEscalations(ctx, minutes, now)) {
      if (!(await claimEscalation(ctx, d.telegramId, d.claimKey))) continue;
      await escalate(d);
      escalated++;
    }
  }
  return { waiting: list.length, reminded, escalated };
}
