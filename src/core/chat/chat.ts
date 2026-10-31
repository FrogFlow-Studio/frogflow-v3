import { serverFailure } from "@/lib/server-failure";
import { chunksOf, inChunks } from "@/lib/in-chunks";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { cleanReason } from "./reason";
import { pauseHours } from "@/core/consultant/pause";

/**
 * Чат с менеджером: продавец из панели «подключается» к диалогу и отвечает
 * сам, бот на это время замолкает. Лог реплик — manager_chat_messages,
 * «последнее состояние» диалога — manager_chat_state (RPC manager_chat_touch
 * делает upsert и инкремент непрочитанных одной операцией).
 */
export type ChatSender = "customer" | "bot" | "manager";
export type ChatDirection = "in" | "out";

const PREVIEW_LEN = 200;

/**
 * Таблицы причин (миграция 19-13) может не быть в базе: тогда причины не пишем
 * и не читаем, а сообщения идут как раньше. Не пробуем ближайшие 10 минут.
 */
let reasonsOffUntil = 0;
const reasonsMissing = (e: { code?: string; message?: string } | null) =>
  Boolean(e) &&
  (e!.code === "PGRST205" ||
    e!.code === "42P01" ||
    /could not find the table|relation .* does not exist/i.test(e!.message ?? ""));
const reasonsOn = () => Date.now() >= reasonsOffUntil;
const markReasonsMissing = () => {
  reasonsOffUntil = Date.now() + 10 * 60_000;
};

export async function recordMessage(
  ctx: TenantContext,
  p: {
    telegramId: number;
    direction: ChatDirection;
    sender: ChatSender;
    text: string;
    /** «Почему бот так ответил» (core/chat/reason): только для ответов бота. */
    reason?: string | null;
  },
): Promise<void> {
  const text = p.text.trim() || "[без текста]";
  const { error: rpcError } = await ctx.db.rpc("manager_chat_touch", {
    p_bot_id: ctx.tenant.id,
    p_telegram_id: p.telegramId,
    p_direction: p.direction,
    p_sender: p.sender,
    p_preview: text.slice(0, PREVIEW_LEN),
  });
  if (rpcError) console.error(`[chat:${ctx.tenant.id}] touch`, rpcError.message);
  // Живая manager_chat_touch не инкрементирует unread_count (расходится с
  // MIGRATION-26; проверено на базе) — считаем непрочитанные здесь, CAS по
  // старому значению, чтобы параллельные реплики не терялись.
  if (p.sender === "customer") await bumpUnread(ctx, p.telegramId);
  const row = {
    bot_id: ctx.tenant.id,
    telegram_id: p.telegramId,
    direction: p.direction,
    sender: p.sender,
    text,
  };
  const reason = p.sender === "bot" ? cleanReason(p.reason) : null;
  const { data: saved, error } = await ctx.db
    .from("manager_chat_messages")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) return void console.error(`[chat:${ctx.tenant.id}] insert`, error.message);
  if (!reason || !saved || !reasonsOn()) return;
  const { error: reasonError } = await ctx.db
    .from("manager_chat_reasons")
    .insert({ bot_id: ctx.tenant.id, message_id: String(saved.id), reason });
  if (reasonError) {
    if (reasonsMissing(reasonError)) markReasonsMissing();
    else console.error(`[chat:${ctx.tenant.id}] reason`, reasonError.message);
  }
}

async function bumpUnread(ctx: TenantContext, telegramId: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error: rowError } = await ctx.db
      .from("manager_chat_state")
      .select("unread_count")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    // Реплика уже записана в журнал: счётчик непрочитанного — best-effort.
    if (rowError) return void console.error(`[chat:${ctx.tenant.id}] unread`, rowError.message);
    if (!row) return;
    const { data: updated, error: updatedError } = await ctx.db
      .from("manager_chat_state")
      .update({ unread_count: (row.unread_count ?? 0) + 1 })
      .eq("telegram_id", telegramId)
      .eq("unread_count", row.unread_count ?? 0)
      .select("telegram_id")
      .maybeSingle();
    if (updatedError)
      return void console.error(`[chat:${ctx.tenant.id}] unread`, updatedError.message);
    if (updated) return;
  }
}

/** Реплика покупателя без текста — заглушкой по виду вложения, чтобы в чате было видно, что пришло. */
export function inboundLogText(m: {
  text?: string | null;
  caption?: string | null;
  photo?: unknown;
  document?: unknown;
  contact?: unknown;
}): string {
  return (
    m.text?.trim() ||
    m.caption?.trim() ||
    (m.photo ? "[фото]" : m.document ? "[файл]" : m.contact ? "[контакт]" : "[без текста]")
  );
}

/** Нажатая кнопка — в чат подписью с 👉, а не сырым callback_data. */
export function tappedButtonText(label: string | null | undefined): string {
  return `👉 ${label?.trim() || "нажал кнопку"}`;
}

/**
 * Ведёт ли диалог человек. Подключение (передача менеджеру, «Подключиться» в
 * «Чате») — пауза, а не навсегда: держится столько, сколько продавец выбрал в
 * «Пауза консультанта» (`consultant_pause_hours`, по умолчанию 6 ч) от
 * подключения или от последнего ответа человека (он продлевает паузу
 * консультанта). 0 — «пока не верну сам». Истёкшее подключение снимается
 * условной записью по `connected_at`: свежее подключение коллеги не затирается.
 * Без `connected_at` (строки до M26) срок неизвестен — держим, как раньше.
 * Раньше подключение не истекало: BOVI 31.10 — 85 диалогов молчали днями.
 */
export async function isManagerConnected(
  ctx: TenantContext,
  telegramId: number,
  now = Date.now(),
): Promise<boolean> {
  const { data, error: dataError } = await ctx.db
    .from("manager_chat_state")
    .select("active, connected_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (dataError) throw serverFailure(`Чат: ${dataError.message}`);
  if (data?.active !== true) return false;
  const hours = pauseHours({ settings: ctx.tenant.settings ?? {} });
  const connectedAt = data.connected_at ? Date.parse(data.connected_at) : NaN;
  if (hours === 0 || !Number.isFinite(connectedAt)) return true;
  if (connectedAt + hours * 3600_000 > now) return true;
  const { data: user, error: userError } = await ctx.db
    .from("bot_users")
    .select("paused_until:state->consultant->>paused_until")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (userError) throw serverFailure(`Чат: ${userError.message}`);
  const pausedUntil = Date.parse(String(user?.paused_until ?? ""));
  if (Number.isFinite(pausedUntil) && pausedUntil > now) return true;
  const { data: released, error: releaseError } = await ctx.db
    .from("manager_chat_state")
    .update({ active: false })
    .eq("telegram_id", telegramId)
    .eq("active", true)
    .eq("connected_at", data.connected_at!)
    .select("telegram_id")
    .maybeSingle();
  if (releaseError) {
    // Срок вышел — бот отвечает; строка «у менеджера» снимется следующей репликой.
    console.error(`[chat:${ctx.tenant.id}] release`, releaseError.message);
    return false;
  }
  if (released) return false;
  // Не совпало — коллега только что подключился заново: его подключение держим.
  return reconnectedSince(ctx, telegramId, data.connected_at!);
}

async function reconnectedSince(
  ctx: TenantContext,
  telegramId: number,
  connectedAt: string,
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("manager_chat_state")
    .select("active, connected_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (error) throw serverFailure(`Чат: ${error.message}`);
  return data?.active === true && data.connected_at !== connectedAt;
}

/**
 * Входящее от покупателя: записать в лог и сказать адаптеру, перехвачен ли
 * диалог менеджером (тогда бот молчит). Без модуля — сразу false и ни
 * одного запроса.
 */
export async function inboundIntercepted(
  ctx: TenantContext,
  telegramId: number,
  text: string,
): Promise<boolean> {
  if (!ctx.tenant.modules.manager_chat) return false;
  await recordMessage(ctx, { telegramId, direction: "in", sender: "customer", text });
  const { reopenOnInbound } = await import("@/core/inbox/inbox");
  await reopenOnInbound(ctx, telegramId);
  return isManagerConnected(ctx, telegramId);
}

export async function connect(ctx: TenantContext, telegramId: number): Promise<void> {
  const { data: existing, error: existingError } = await ctx.db
    .from("manager_chat_state")
    .select("telegram_id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (existingError) throw serverFailure(`Чат: ${existingError.message}`);
  const patch = { active: true, connected_at: new Date().toISOString() };
  const { error } = existing
    ? await ctx.db.from("manager_chat_state").update(patch).eq("telegram_id", telegramId)
    : await ctx.db
        .from("manager_chat_state")
        .insert({ bot_id: ctx.tenant.id, telegram_id: telegramId, ...patch });
  if (error) throw serverFailure(`Чат: ${error.message}`);
}

export async function disconnect(ctx: TenantContext, telegramId: number): Promise<void> {
  const { error } = await ctx.db
    .from("manager_chat_state")
    .update({ active: false })
    .eq("telegram_id", telegramId);
  if (error) throw serverFailure(`Чат: ${error.message}`);
}

export async function markRead(ctx: TenantContext, telegramId: number): Promise<void> {
  const { error } = await ctx.db
    .from("manager_chat_state")
    .update({ unread_count: 0 })
    .eq("telegram_id", telegramId);
  if (error) throw serverFailure(`Чат: ${error.message}`);
}

export type Conversation = {
  telegram_id: number;
  active: boolean;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_direction: string | null;
  unread_count: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  /** telegram | instagram | whatsapp — куда уходит ответ менеджера. */
  platform: string;
  user_key: string | null;
  /** До какого времени ИИ-консультант молчит в диалоге (core/consultant/pause); null — не молчит. */
  bot_paused_until: string | null;
};

function activePause(until: unknown, now: number): string | null {
  return typeof until === "string" && Date.parse(until) > now ? until : null;
}

export type StateRow = {
  telegram_id: number;
  active: boolean;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_direction: string | null;
  unread_count: number;
};

export const STATE_COLUMNS =
  "telegram_id, active, last_message_at, last_message_preview, last_message_direction, unread_count";

/** Граница страницы списка: диалоги строго старше (last_message_at, telegram_id). */
export type ConversationCursor = { last_message_at: string; telegram_id: number };

/**
 * Страница строк состояния диалогов, свежие сверху; порядок заканчивается
 * telegram_id (по убыванию), поэтому одинаковое время не теряет и не дублирует строки.
 * `unreadOnly` — только с непрочитанными.
 */
export async function listConversationStates(
  ctx: TenantContext,
  opts: { before?: ConversationCursor | null; limit: number; unreadOnly?: boolean },
): Promise<StateRow[]> {
  let q = ctx.db.from("manager_chat_state").select(STATE_COLUMNS);
  if (opts.unreadOnly) q = q.gt("unread_count", 0);
  const b = opts.before;
  if (b)
    q = q.or(
      `last_message_at.lt.${b.last_message_at},and(last_message_at.eq.${b.last_message_at},telegram_id.lt.${b.telegram_id})`,
    );
  const { data, error } = await q
    .order("last_message_at", { ascending: false })
    .order("telegram_id", { ascending: false })
    .limit(opts.limit);
  if (error) throw serverFailure(`Чат: диалоги: ${error.message}`);
  return (data ?? []) as StateRow[];
}

/** Диалоги, где что-то менялось начиная с `since` (включительно) — для опроса, постранично. */
export async function listConversationStatesSince(
  ctx: TenantContext,
  since: string,
): Promise<StateRow[]> {
  return (await pageAll(
    (from, to) =>
      ctx.db
        .from("manager_chat_state")
        .select(STATE_COLUMNS)
        .gte("last_message_at", since)
        .order("last_message_at", { ascending: false })
        .order("telegram_id", { ascending: false })
        .range(from, to),
    "Чат: изменившиеся диалоги",
  )) as StateRow[];
}

/** Строки состояния этих диалогов (куски по 200); нет строки — диалога нет. */
export async function listConversationStatesByIds(
  ctx: TenantContext,
  telegramIds: readonly number[],
): Promise<StateRow[]> {
  return (await inChunks(
    telegramIds,
    (chunk) => ctx.db.from("manager_chat_state").select(STATE_COLUMNS).in("telegram_id", chunk),
    "Чат: диалоги по id",
  )) as StateRow[];
}

/** id диалогов с непрочитанным: опрос сверяет с ними открытый список (прочитал коллега). */
export async function listUnreadIds(ctx: TenantContext): Promise<number[]> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("manager_chat_state")
        .select("telegram_id")
        .gt("unread_count", 0)
        .order("telegram_id")
        .range(from, to),
    "Чат: непрочитанные",
  );
  return rows.map((r) => Number(r.telegram_id));
}

/** К строкам состояния — имя, канал и пауза консультанта покупателя (куски по 200). */
export async function conversationsOf(
  ctx: TenantContext,
  states: readonly StateRow[],
): Promise<Conversation[]> {
  if (!states.length) return [];
  const users = await inChunks(
    states.map((s) => s.telegram_id),
    (chunk) =>
      ctx.db
        .from("bot_users")
        // Из состояния — только срок паузы: история консультанта в state тяжёлая, а список опрашивается.
        .select(
          "telegram_id, username, first_name, last_name, platform, user_key, bot_paused_until:state->consultant->>paused_until",
        )
        .in("telegram_id", chunk),
    "Чат",
  );
  const byId = new Map(users.map((u) => [Number(u.telegram_id), u]));
  const now = Date.now();
  return states.map((s) => {
    const u = byId.get(Number(s.telegram_id));
    return {
      ...s,
      telegram_id: Number(s.telegram_id),
      username: u?.username ?? null,
      first_name: u?.first_name ?? null,
      last_name: u?.last_name ?? null,
      platform: u?.platform ?? "telegram",
      user_key: u?.user_key ?? null,
      bot_paused_until: activePause(u?.bot_paused_until, now),
    };
  });
}

export type ChatMessage = {
  id: string;
  direction: ChatDirection;
  sender: ChatSender;
  text: string;
  created_at: string;
  /** Почему бот так ответил (только ответы бота; нет — пока не записывали или нет колонки). */
  reason?: string | null;
};

/** Сколько сообщений окно диалога грузит за раз. */
export const MESSAGES_PAGE = 200;

/** Граница страницы переписки: сообщения строго раньше (created_at, id). */
export type MessageCursor = { created_at: string; id: string };

/**
 * Страница переписки: последние `limit` сообщений или, с `before`, `limit`
 * сообщений раньше указанного. Порядок заканчивается id — одинаковый created_at
 * не теряет и не дублирует строки. `hasMore` — есть ли ещё раньше.
 */
export async function listMessages(
  ctx: TenantContext,
  telegramId: number,
  opts: { before?: MessageCursor | null; limit?: number } = {},
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const limit = opts.limit ?? MESSAGES_PAGE;
  const b = opts.before;
  let q = ctx.db
    .from("manager_chat_messages")
    .select("id, direction, sender, text, created_at")
    .eq("telegram_id", telegramId);
  if (b) q = q.or(`created_at.lt.${b.created_at},and(created_at.eq.${b.created_at},id.lt.${b.id})`);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw serverFailure(`Чат: ${error.message}`);
  const rows = (data ?? []) as unknown as ChatMessage[];
  const messages = rows.slice(0, limit).reverse();
  await attachReasons(ctx, messages);
  return { messages, hasMore: rows.length > limit };
}

/**
 * Причины ответов бота («Почему бот так ответил») для показанных сообщений.
 * Подсказка необязательная: нет таблицы (миграция 19-13 не применена) или чтение
 * упало — страница открывается без причин, ошибка в журнал.
 */
async function attachReasons(ctx: TenantContext, messages: ChatMessage[]): Promise<void> {
  if (!reasonsOn()) return;
  const ids = messages.filter((m) => m.sender === "bot").map((m) => String(m.id));
  const byId = new Map<string, string>();
  for (const chunk of chunksOf(ids)) {
    const { data, error } = await ctx.db
      .from("manager_chat_reasons")
      .select("message_id, reason")
      .in("message_id", chunk);
    if (error) {
      if (reasonsMissing(error)) markReasonsMissing();
      else console.error(`[chat:${ctx.tenant.id}] reasons`, error.message);
      return;
    }
    for (const r of data ?? []) byId.set(r.message_id, r.reason);
  }
  for (const m of messages) {
    const reason = byId.get(String(m.id));
    if (reason) m.reason = reason;
  }
}

/**
 * Последнее входящее сообщение покупателя — от него считается окно ответа
 * Instagram/WhatsApp (core/chat/reply-window). Исходящие окно не продлевают.
 */
export async function lastInboundAt(
  ctx: TenantContext,
  telegramId: number,
): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("manager_chat_messages")
    .select("created_at")
    .eq("telegram_id", telegramId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw serverFailure(`Чат: ${error.message}`);
  return data?.[0]?.created_at ?? null;
}

/**
 * Сумма непрочитанных для бейджа в шапке (на каждой странице админки): читаются только
 * диалоги с непрочитанным, а не все диалоги магазина.
 */
export async function totalUnread(ctx: TenantContext): Promise<number> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("manager_chat_state")
        .select("unread_count")
        .gt("unread_count", 0)
        .order("telegram_id")
        .range(from, to),
    "непрочитанные диалоги",
  );
  return rows.reduce((s, r) => s + (r.unread_count ?? 0), 0);
}
