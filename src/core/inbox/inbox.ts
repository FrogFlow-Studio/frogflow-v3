import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Conversation } from "@/core/chat/chat";
import { TICKET_PREFIX } from "@/core/helpdesk/tickets";

/**
 * Единый входящий: переписки Telegram, Instagram и WhatsApp в одном окне
 * (сами диалоги — чат с менеджером, core/chat) плюс учёт поверх них:
 * статус «открыт/решён» и ответственный. Своей таблицы нет: одна строка на
 * диалог в `zernio_logs` (`event_id = inbox:<bot>:<telegram_id>` — event_id
 * уникален на всю базу, поэтому с id бота; `event_type = inbox`,
 * `status = open|closed`), остальное — в payload. Новая реплика покупателя
 * в решённом диалоге открывает его снова.
 */
export const INBOX_EVENT_TYPE = "inbox";
export const INBOX_STATUSES = ["open", "closed"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export type InboxMeta = {
  telegramId: number;
  status: InboxStatus;
  assignee: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export const inboxEventId = (botId: string, telegramId: number) => `inbox:${botId}:${telegramId}`;

const DEFAULT_META = (telegramId: number): InboxMeta => ({
  telegramId,
  status: "open",
  assignee: null,
  updatedAt: null,
  updatedBy: null,
});

type Payload = {
  telegram_id?: number;
  assignee?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
};

export function rowToMeta(r: { status: string; payload: Json }): InboxMeta {
  const p = (r.payload ?? {}) as unknown as Payload;
  return {
    telegramId: Number(p.telegram_id ?? 0),
    status: r.status === "closed" ? "closed" : "open",
    assignee: typeof p.assignee === "string" && p.assignee ? p.assignee : null,
    updatedAt: p.updated_at ?? null,
    updatedBy: p.updated_by ?? null,
  };
}

/** Учёт по диалогам: у кого строки нет — открыт и без ответственного. */
export async function inboxMetaFor(
  ctx: TenantContext,
  telegramIds: readonly number[],
): Promise<Map<number, InboxMeta>> {
  const out = new Map<number, InboxMeta>();
  if (!telegramIds.length) return out;
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select("status, payload")
    .in(
      "event_id",
      telegramIds.map((id) => inboxEventId(ctx.tenant.id, id)),
    );
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const m = rowToMeta(row);
    if (m.telegramId) out.set(m.telegramId, m);
  }
  for (const id of telegramIds) if (!out.has(id)) out.set(id, DEFAULT_META(id));
  return out;
}

export async function getInboxMeta(ctx: TenantContext, telegramId: number): Promise<InboxMeta> {
  return (await inboxMetaFor(ctx, [telegramId])).get(telegramId) ?? DEFAULT_META(telegramId);
}

/**
 * Статус и/или ответственный диалога. Строка живёт в zernio_logs и
 * подчищается ретеншеном через 180 дней от создания — тогда диалог просто
 * снова «открыт и ничей».
 */
export async function setInboxMeta(
  ctx: TenantContext,
  telegramId: number,
  patch: { status?: InboxStatus; assignee?: string | null },
  actor: string,
): Promise<InboxMeta> {
  const current = await getInboxMeta(ctx, telegramId);
  const next: InboxMeta = {
    telegramId,
    status: patch.status ?? current.status,
    assignee: patch.assignee !== undefined ? patch.assignee || null : current.assignee,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
  const payload = {
    telegram_id: telegramId,
    assignee: next.assignee,
    updated_at: next.updatedAt,
    updated_by: next.updatedBy,
  } as unknown as Json;
  const eventId = inboxEventId(ctx.tenant.id, telegramId);
  const { data: existing } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();
  const { error } = existing
    ? await ctx.db
        .from("zernio_logs")
        .update({ status: next.status, payload })
        .eq("id", existing.id)
    : await ctx.db.from("zernio_logs").insert({
        bot_id: ctx.tenant.id,
        event_id: eventId,
        event_type: INBOX_EVENT_TYPE,
        status: next.status,
        payload,
      });
  if (error) throw new Error(error.message);
  if (patch.status === "closed") await closeTicketsFor(ctx, telegramId, actor);
  return next;
}

/** Покупатель написал снова — решённый диалог открывается. Один запрос по уникальному ключу. */
export async function reopenOnInbound(ctx: TenantContext, telegramId: number): Promise<void> {
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({ status: "open" })
    .eq("event_id", inboxEventId(ctx.tenant.id, telegramId))
    .eq("status", "closed");
  if (error) console.error(`[inbox:${ctx.tenant.id}] reopen`, error.message);
}

/** «Решено» в диалоге закрывает и обращения helpdesk этого покупателя. */
async function closeTicketsFor(ctx: TenantContext, telegramId: number, actor: string) {
  const { data } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .like("event_id", `${TICKET_PREFIX}%`)
    .in("status", ["open", "pending"])
    .contains("payload", { telegram_id: telegramId });
  if (!data?.length) return;
  const { updateTicket } = await import("@/core/helpdesk/tickets");
  for (const t of data) await updateTicket(ctx, t.id, { status: "closed" }, actor);
}

/** Номера незакрытых обращений по покупателям — значок в списке диалогов. */
export async function openTicketNumbers(
  ctx: TenantContext,
  telegramIds: readonly number[],
): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!telegramIds.length) return out;
  const want = new Set(telegramIds);
  const { data } = await ctx.db
    .from("zernio_logs")
    .select("payload")
    .like("event_id", `${TICKET_PREFIX}%`)
    .in("status", ["open", "pending"])
    .order("created_at", { ascending: true })
    .limit(500);
  for (const row of data ?? []) {
    const p = (row.payload ?? {}) as { telegram_id?: number; number?: number };
    const id = Number(p.telegram_id ?? 0);
    if (!want.has(id) || !p.number) continue;
    out.set(id, [...(out.get(id) ?? []), Number(p.number)]);
  }
  return out;
}

/* ── список: фильтры и порядок ─────────────────────────────────────── */

export type InboxChannel = "telegram" | "instagram" | "whatsapp";
export type InboxFilter = {
  /** open — только открытые, closed — решённые, all — все. */
  status: InboxStatus | "all";
  /** mine — мои, none — без ответственного, all — все. */
  who: "mine" | "none" | "all";
  channel: InboxChannel | "all";
};

export type InboxItem = Conversation & {
  status: InboxStatus;
  assignee: string | null;
  tickets: number[];
};

export function channelOf(platform: string | null | undefined): InboxChannel {
  return platform === "instagram" || platform === "whatsapp" ? platform : "telegram";
}

export function mergeInbox(
  conversations: readonly Conversation[],
  meta: Map<number, InboxMeta>,
  tickets: Map<number, number[]> = new Map(),
): InboxItem[] {
  return conversations.map((c) => {
    const m = meta.get(c.telegram_id);
    return {
      ...c,
      status: m?.status ?? "open",
      assignee: m?.assignee ?? null,
      tickets: tickets.get(c.telegram_id) ?? [],
    };
  });
}

/**
 * Фильтр списка. Открытые с непрочитанными — наверх, дальше по свежести
 * (порядок свежести уже задан listConversations).
 */
export function filterInbox(items: readonly InboxItem[], f: InboxFilter, me: string): InboxItem[] {
  const kept = items.filter(
    (i) =>
      (f.status === "all" || i.status === f.status) &&
      (f.who === "all" || (f.who === "mine" ? i.assignee === me : i.assignee === null)) &&
      (f.channel === "all" || channelOf(i.platform) === f.channel),
  );
  const urgent = (i: InboxItem) => (i.status === "open" && i.unread_count > 0 ? 0 : 1);
  return kept
    .map((i, n) => ({ i, n }))
    .sort((a, b) => urgent(a.i) - urgent(b.i) || a.n - b.n)
    .map((x) => x.i);
}

export function inboxCounts(items: readonly InboxItem[], me: string) {
  const open = items.filter((i) => i.status === "open");
  return {
    open: open.length,
    mine: open.filter((i) => i.assignee === me).length,
    unassigned: open.filter((i) => i.assignee === null).length,
  };
}

/* ── быстрые ответы: app_settings.inbox_quick_replies (JSON) ─────── */

export const QUICK_REPLIES_KEY = "inbox_quick_replies";
export const QUICK_REPLIES_MAX = 30;
export type QuickReply = { title: string; text: string };

export function parseQuickReplies(raw: string | null | undefined): QuickReply[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return cleanQuickReplies(v as Partial<QuickReply>[]);
  } catch {
    return [];
  }
}

/** Пустые выкидываем, длины режем, не больше QUICK_REPLIES_MAX. */
export function cleanQuickReplies(list: readonly Partial<QuickReply>[]): QuickReply[] {
  const out: QuickReply[] = [];
  for (const r of list) {
    const text = typeof r?.text === "string" ? r.text.trim().slice(0, 2000) : "";
    if (!text) continue;
    const title =
      (typeof r.title === "string" ? r.title.trim().slice(0, 60) : "") ||
      text.split("\n")[0]!.slice(0, 40);
    out.push({ title, text });
    if (out.length >= QUICK_REPLIES_MAX) break;
  }
  return out;
}

/** Подстановка {name} — имя покупателя; без имени «Здравствуйте, {name}!» → «Здравствуйте!». */
export function fillQuickReply(text: string, c: Pick<Conversation, "first_name">): string {
  const name = c.first_name?.trim();
  return name
    ? text.replace(/\{name\}/g, name)
    : text.replace(/,[ \t]*\{name\}/g, "").replace(/\{name\},?[ \t]*/g, "");
}
