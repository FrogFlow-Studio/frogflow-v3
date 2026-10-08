import type { ZernioInboxMessage } from "./inbox-types";

/**
 * Добор входящих, которые не донёс вебхук (перенос v1
 * src/lib/consultant/inbox-poll.ts). Если Zernio не прислал
 * message.received, покупатель в Direct/WhatsApp остаётся без ответа, и об
 * этом никто не знает. Крон раз в минуту смотрит ящик Zernio и отдаёт
 * последнее неотвеченное входящее тому же обработчику, что и вебхук.
 *
 * Здесь — только решение «отвечать ли» по переписке, без базы и сети.
 */

/**
 * Опрос добирает то, что не донёс вебхук, и не должен с ним соревноваться.
 * Живой случай v1 23.09: опрос забрал сообщение раньше вебхука, который
 * пришёл через несколько секунд, и покупательница получила два разных
 * ответа на один вопрос. Полторы минуты вебхуку хватает с запасом, а
 * пропущенное опрос всё равно заберёт на следующем тике. Дубль при позднем
 * вебхуке закрывает ещё и метка сообщения (message-claim.server).
 */
export const WEBHOOK_GRACE_MS = 90_000;
/** Старше 15 минут — не отвечаем: ответ на давний вопрос покупателя только путает (v1 MAX_AGE_MS). */
export const MAX_AGE_MS = 15 * 60_000;

export type MissedSkip =
  /** Входящих в хвосте нет. */
  | "no_incoming"
  /** После входящего уже есть исходящее (бот, менеджер) или бот ответил позже. */
  | "answered"
  /** Без времени не понять ни возраст, ни окно вебхука — не отвечаем. */
  | "no_time"
  | "too_old"
  /** Вебхук ещё может прийти. */
  | "grace"
  /** Диалог вернули боту позже этого сообщения: старое не трогаем. */
  | "before_resume"
  | "paused"
  /** Ни текста, ни вложения — отвечать не на что. */
  | "empty";

export type MissedVerdict =
  { answer: true; message: ZernioInboxMessage; at: number } | { answer: false; why: MissedSkip };

export type DialogMemory = {
  /** state.consultant.paused_until в будущем. */
  paused: boolean;
  /** state.consultant.resumed_at — диалог вернули боту (сброс памяти). */
  resumedAt?: string | null;
  /** state.consultant.last_reply_at — последний ответ консультанта. */
  lastReplyAt?: string | null;
};

const time = (iso: string | null | undefined) => Date.parse(iso ?? "");

/**
 * Последнее входящее переписки, если на него никто не ответил и время
 * подходит. Переписка — в хронологическом порядке (listConversationMessages).
 */
export function missedIncoming(
  messages: readonly ZernioInboxMessage[],
  memory: DialogMemory,
  now = Date.now(),
): MissedVerdict {
  const incoming = [...messages].reverse().find((m) => m.direction === "incoming");
  if (!incoming) return { answer: false, why: "no_incoming" };
  const at = time(incoming.createdAt);
  if (!Number.isFinite(at)) return { answer: false, why: "no_time" };
  // Исходящее не раньше входящего — на него уже ответили (бот или человек).
  const answered = messages.some(
    (m) =>
      m.direction === "outgoing" && Number.isFinite(time(m.createdAt)) && time(m.createdAt) >= at,
  );
  if (answered) return { answer: false, why: "answered" };
  // Ответ бота мог не попасть в хвост Zernio (задержка ленты) — память консультанта знает.
  const replied = time(memory.lastReplyAt);
  if (Number.isFinite(replied) && replied >= at) return { answer: false, why: "answered" };
  if (now - at > MAX_AGE_MS) return { answer: false, why: "too_old" };
  if (now - at < WEBHOOK_GRACE_MS) return { answer: false, why: "grace" };
  const resumed = time(memory.resumedAt);
  if (Number.isFinite(resumed) && at <= resumed) return { answer: false, why: "before_resume" };
  if (memory.paused) return { answer: false, why: "paused" };
  if (!incoming.message?.trim() && !incoming.attachments?.length)
    return { answer: false, why: "empty" };
  return { answer: true, message: incoming, at };
}

/** Ключ сообщения для метки «уже обработано»: id Zernio, иначе id у Meta. */
export function zernioMessageKey(m: {
  id?: string | null;
  platformMessageId?: string | null;
}): string | null {
  const key = (m.id ?? "").trim() || (m.platformMessageId ?? "").trim();
  return key || null;
}

/**
 * Событие опроса в журнале zernio_logs: своё event_id с префиксом, чтобы
 * два крона подряд не завели одно сообщение дважды, а журнал ответов
 * (consultant_message_runs.source) отличал опрос от вебхука.
 */
export const POLL_EVENT_PREFIX = "poll:";

export function pollEventId(botId: string, key: string): string {
  return `${POLL_EVENT_PREFIX}${botId}:${key}`.slice(0, 250);
}

export function isPollEvent(eventId: string | null | undefined): boolean {
  return Boolean(eventId?.startsWith(POLL_EVENT_PREFIX));
}
