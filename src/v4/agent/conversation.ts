import { serverFailure } from "@/lib/server-failure";
import type { V4Db } from "../core/db";

/**
 * Разговор с покупателем (migrations/v4/017-conversation.sql): журнал,
 * повторы вебхуков, ход, предел ответов ИИ в день, память, блок. Вся
 * логика «один раз» — в SQL-функциях; здесь только вызовы и типы.
 */

export const AGENT_MODES = ["live", "shadow", "test"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export const MESSAGE_CHANNELS = ["telegram", "instagram", "whatsapp", "web", "test"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const FACT_KEYS = [
  "language",
  "country",
  "name",
  "looking_for",
  "grade",
  "subject",
  "for_whom",
  "notes",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

/** Причины простого ответа без ИИ (поле messages.reason). */
export const FALLBACK_REASONS = [
  "limit_buyer",
  "limit_day",
  "wallet_empty",
  "model_failed",
  "check_failed",
  "ai_off",
  /** Голосовое не расшифровалось: просим написать текстом, модель не зовём. */
  "voice_unclear",
] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/** Предел ответов ИИ одному покупателю в день (Спецификация, E05). */
export const AI_REPLIES_PER_BUYER_DAY = 40;

export type ShownButton = { offerId?: string; productId?: string; label: string };
export type DoneAction = { kind: string } & Record<string, unknown>;

export const MESSAGE_KINDS = ["text", "voice", "photo"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export type HistoryMessage = {
  id: number;
  direction: "in" | "out";
  author: "buyer" | "bot" | "seller";
  kind: MessageKind;
  text: string;
  buttons: ShownButton[];
  actions: DoneAction[];
  createdAt: string;
};

const iso = (now?: Date) => (now ? { p_now: now.toISOString() } : {});

function one<T>(rows: Record<string, unknown>[], fn: string): T {
  const r = rows[0];
  if (!r || !(fn in r)) throw serverFailure(`v4.${fn}: пустой ответ`);
  return r[fn] as T;
}

export async function recordIncoming(
  db: V4Db,
  a: {
    botId: string;
    buyerId: string;
    channel: MessageChannel;
    externalId: string | null;
    text: string;
    mode: AgentMode;
    /** voice — голосовое (текст ставит setVoiceText), photo — фото с подписью. */
    kind?: MessageKind;
    now?: Date;
  },
): Promise<{ messageId: number; duplicate: boolean }> {
  const r = one<{ message_id: number; duplicate: boolean }>(
    await db.call("record_incoming", {
      p_bot_id: a.botId,
      p_buyer_id: a.buyerId,
      p_channel: a.channel,
      p_external_id: a.externalId ?? "",
      p_text: a.text,
      p_mode: a.mode,
      p_kind: a.kind ?? "text",
      ...iso(a.now),
    }),
    "record_incoming",
  );
  return { messageId: Number(r.message_id), duplicate: r.duplicate };
}

export async function takeTurn(
  db: V4Db,
  a: { botId: string; buyerId: string; turnId: string; ttlSeconds?: number; now?: Date },
): Promise<boolean> {
  return one<boolean>(
    await db.call("take_turn", {
      p_bot_id: a.botId,
      p_buyer_id: a.buyerId,
      p_turn_id: a.turnId,
      p_ttl_seconds: a.ttlSeconds ?? 90,
      ...iso(a.now),
    }),
    "take_turn",
  );
}

/** Отпустить ход; число входящих после afterMessageId, на которые ещё нет ответа (0 — отпущен). */
export async function releaseTurn(
  db: V4Db,
  a: {
    botId: string;
    buyerId: string;
    turnId: string;
    afterMessageId: number;
    /** Считать входящие только этого режима. Без него ход live не держит очередь test. */
    mode?: "live" | "shadow" | "test";
  },
): Promise<number> {
  return Number(
    one<number>(
      await db.call("release_turn", {
        p_bot_id: a.botId,
        p_buyer_id: a.buyerId,
        p_turn_id: a.turnId,
        p_after_message_id: a.afterMessageId,
        p_mode: a.mode ?? "live",
      }),
      "release_turn",
    ),
  );
}

export async function countAiReply(
  db: V4Db,
  a: { botId: string; buyerId: string; limit?: number; now?: Date },
): Promise<boolean> {
  return one<boolean>(
    await db.call("count_ai_reply", {
      p_bot_id: a.botId,
      p_buyer_id: a.buyerId,
      p_limit: a.limit ?? AI_REPLIES_PER_BUYER_DAY,
      ...iso(a.now),
    }),
    "count_ai_reply",
  );
}

export async function recordReply(
  db: V4Db,
  a: {
    botId: string;
    buyerId: string;
    channel: MessageChannel;
    text: string;
    buttons?: ShownButton[];
    actions?: DoneAction[];
    mode: AgentMode;
    source: "model" | "fallback" | "seller";
    reason?: FallbackReason | null;
    costMicroUsd?: number;
    promptVariant?: string | null;
    checkResult?: string | null;
    author?: "bot" | "seller";
    now?: Date;
  },
): Promise<number> {
  return Number(
    one<number>(
      await db.call("record_reply", {
        p_bot_id: a.botId,
        p_buyer_id: a.buyerId,
        p_channel: a.channel,
        p_text: a.text,
        p_buttons: a.buttons ?? [],
        p_actions: a.actions ?? [],
        p_mode: a.mode,
        p_source: a.source,
        p_reason: a.reason ?? null,
        p_cost_micro_usd: Math.max(0, Math.round(a.costMicroUsd ?? 0)),
        p_prompt_variant: a.promptVariant ?? null,
        p_check_result: a.checkResult ?? null,
        p_author: a.author ?? "bot",
        ...iso(a.now),
      }),
      "record_reply",
    ),
  );
}

export async function conversationHistory(
  db: V4Db,
  a: { botId: string; buyerId: string; mode: AgentMode; limit?: number },
): Promise<HistoryMessage[]> {
  const rows = await db.call("conversation_history", {
    p_bot_id: a.botId,
    p_buyer_id: a.buyerId,
    p_mode: a.mode,
    p_limit: a.limit ?? 20,
  });
  return rows.map((r) => ({
    id: Number(r.id),
    direction: r.direction as HistoryMessage["direction"],
    author: r.author as HistoryMessage["author"],
    kind: (MESSAGE_KINDS.includes(r.kind as MessageKind) ? r.kind : "text") as MessageKind,
    text: String(r.text ?? ""),
    buttons: (r.buttons ?? []) as ShownButton[],
    actions: (r.actions ?? []) as DoneAction[],
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

/** Расшифровка голосового в журнал; false — не голосовое или текст уже стоит. */
export async function setVoiceText(
  db: V4Db,
  a: { botId: string; messageId: number; text: string },
): Promise<boolean> {
  return one<boolean>(
    await db.call("set_voice_text", {
      p_bot_id: a.botId,
      p_message_id: a.messageId,
      p_text: a.text,
    }),
    "set_voice_text",
  );
}

export type RememberResult = "ok" | "bad_key" | "bad_value" | "forbidden";

export async function rememberFact(
  db: V4Db,
  a: {
    botId: string;
    buyerId: string;
    key: string;
    value: string;
    source?: "buyer" | "bot" | "seller";
    now?: Date;
  },
): Promise<RememberResult> {
  return one<RememberResult>(
    await db.call("remember_fact", {
      p_bot_id: a.botId,
      p_buyer_id: a.buyerId,
      p_key: a.key,
      p_value: a.value,
      p_source: a.source ?? "bot",
      ...iso(a.now),
    }),
    "remember_fact",
  );
}

export async function blockBuyer(
  db: V4Db,
  a: { botId: string; buyerId: string; by: string; now?: Date },
): Promise<boolean> {
  return one<boolean>(
    await db.call("block_buyer", {
      p_bot_id: a.botId,
      p_buyer_id: a.buyerId,
      p_by: a.by,
      ...iso(a.now),
    }),
    "block_buyer",
  );
}

export async function unblockBuyer(
  db: V4Db,
  a: { botId: string; buyerId: string },
): Promise<boolean> {
  return one<boolean>(
    await db.call("unblock_buyer", { p_bot_id: a.botId, p_buyer_id: a.buyerId }),
    "unblock_buyer",
  );
}

/**
 * Телефон и почта покупателя — в журнале как есть (продавцу нужно), а в
 * историю для модели уходят замаскированными: `+7 7** *** ** 51`, `a***@mail.ru`.
 * Номер карты (13–19 цифр подряд с пробелами) — тоже.
 */
export function maskContacts(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/gu, (m) => `${m[0]}***@${m.split("@")[1]}`)
    .replace(/(?<![\d])(\+?\d[\d\s()-]{8,22}\d)(?![\d])/gu, (m) => {
      const digits = m.replace(/\D/gu, "");
      if (digits.length < 10 || digits.length > 19) return m;
      let seen = 0;
      const keepHead = m.trim().startsWith("+") ? 2 : 1;
      return m.replace(/\d/gu, (d) => {
        seen++;
        return seen <= keepHead || seen > digits.length - 2 ? d : "*";
      });
    });
}

/**
 * Обезличить покупателя по его просьбе (В4): имя, почта, тексты сообщений,
 * факты и внешние id стираются; заказы и деньги остаются. false — нет такого.
 */
export async function forgetBuyer(
  db: V4Db,
  a: { botId: string; buyerId: string; by: string; now?: Date },
): Promise<boolean> {
  return Boolean(
    one<boolean>(
      await db.call("forget_buyer", {
        p_bot_id: a.botId,
        p_buyer_id: a.buyerId,
        p_by: a.by,
        ...iso(a.now),
      }),
      "forget_buyer",
    ),
  );
}

export type AiValueReport = {
  repliesModel: number;
  repliesSimple: number;
  spentMicroUsd: number;
  handoffs: number;
  offersShown: number;
  offersPressed: number;
  ordersPaid: number;
  revenueMinor: Record<string, number>;
  costPerPaidOrderMicroUsd: number | null;
};

/** Что ИИ стоил и что принёс за период (Р9), только боевой режим. */
export async function aiValueReport(
  db: V4Db,
  a: { botId: string; from: Date; to: Date },
): Promise<AiValueReport> {
  const r = one<Record<string, unknown> | null>(
    await db.call("ai_value_report", {
      p_bot_id: a.botId,
      p_from: a.from.toISOString(),
      p_to: a.to.toISOString(),
    }),
    "ai_value_report",
  );
  if (!r) throw serverFailure("v4.ai_value_report: пустой ответ");
  const rev = (r.revenue_minor ?? {}) as Record<string, unknown>;
  return {
    repliesModel: Number(r.replies_model),
    repliesSimple: Number(r.replies_simple),
    spentMicroUsd: Number(r.spent_micro_usd),
    handoffs: Number(r.handoffs),
    offersShown: Number(r.offers_shown),
    offersPressed: Number(r.offers_pressed),
    ordersPaid: Number(r.orders_paid),
    revenueMinor: Object.fromEntries(Object.entries(rev).map(([k, v]) => [k, Number(v)])),
    costPerPaidOrderMicroUsd:
      r.cost_per_paid_order_micro_usd == null ? null : Number(r.cost_per_paid_order_micro_usd),
  };
}
