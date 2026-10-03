import { serverFailure } from "@/lib/server-failure";
import { inChunks } from "@/lib/in-chunks";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";

/**
 * Чат с менеджером: продавец из панели «подключается» к диалогу и отвечает
 * сам, бот на это время замолкает. Лог реплик — manager_chat_messages,
 * «последнее состояние» диалога — manager_chat_state (RPC manager_chat_touch
 * делает upsert и инкремент непрочитанных одной операцией).
 */
export type ChatSender = "customer" | "bot" | "manager";
export type ChatDirection = "in" | "out";

const PREVIEW_LEN = 200;

export async function recordMessage(
  ctx: TenantContext,
  p: { telegramId: number; direction: ChatDirection; sender: ChatSender; text: string },
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
  const { error } = await ctx.db.from("manager_chat_messages").insert({
    bot_id: ctx.tenant.id,
    telegram_id: p.telegramId,
    direction: p.direction,
    sender: p.sender,
    text,
  });
  if (error) console.error(`[chat:${ctx.tenant.id}] insert`, error.message);
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

export async function isManagerConnected(ctx: TenantContext, telegramId: number): Promise<boolean> {
  const { data, error: dataError } = await ctx.db
    .from("manager_chat_state")
    .select("active")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (dataError) throw serverFailure(`Чат: ${dataError.message}`);
  return data?.active === true;
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
  if (error) throw new Error(error.message);
}

export async function disconnect(ctx: TenantContext, telegramId: number): Promise<void> {
  const { error } = await ctx.db
    .from("manager_chat_state")
    .update({ active: false })
    .eq("telegram_id", telegramId);
  if (error) throw new Error(error.message);
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

export async function listConversations(ctx: TenantContext, limit = 200): Promise<Conversation[]> {
  const { data: states, error } = await ctx.db
    .from("manager_chat_state")
    .select(
      "telegram_id, active, last_message_at, last_message_preview, last_message_direction, unread_count",
    )
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  if (!states?.length) return [];
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
};

export async function listMessages(
  ctx: TenantContext,
  telegramId: number,
  limit = 500,
): Promise<ChatMessage[]> {
  const { data, error } = await ctx.db
    .from("manager_chat_messages")
    .select("id, direction, sender, text, created_at")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ChatMessage[]).reverse();
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
  if (error) throw new Error(error.message);
  return data?.[0]?.created_at ?? null;
}

export async function totalUnread(ctx: TenantContext): Promise<number> {
  const rows = await pageAll(
    (from, to) => ctx.db.from("manager_chat_state").select("unread_count").range(from, to),
    "непрочитанные диалоги",
  );
  return rows.reduce((s, r) => s + (r.unread_count ?? 0), 0);
}
