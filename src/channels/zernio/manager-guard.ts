import type { ZernioInboxMessage } from "./inbox-types";

/**
 * «В диалоге уже отвечает менеджер» — проверка перед тем, как консультант
 * заговорит. Продавцы отвечают из приложения Instagram/WhatsApp, а не только
 * из панели, и Zernio исходящих событий не присылает (в журнале v1 за сутки —
 * только message.received и comment.received). Поэтому перед каждым ответом
 * смотрим хвост переписки глазами Zernio: исходящее, которое отправляли не
 * мы и которое новее нашего последнего ответа, — менеджер, и бот молчит.
 * Один лишний запрос на сообщение; бот, перебивающий живого человека, дороже.
 */

/** Наше сообщение появляется в ленте Zernio с задержкой, время может разойтись. */
export const BOT_ECHO_GRACE_MS = 90_000;
/** Бот в диалоге ещё не отвечал — сравнивать не с чем: считаем менеджером только свежее исходящее. */
export const MANAGER_LOOKBACK_MS = 12 * 60 * 60 * 1000;
/** Менеджер, писавший недавно, остаётся в чате, даже если бот успел ответить после него. */
export const ACTIVE_MANAGER_WINDOW_MS = 30 * 60 * 1000;
const TAIL = 12;

export type GuardState = {
  /** Когда бот отвечал в этом диалоге последний раз. */
  lastBotReplyAt?: string | null;
  /** Наши прошлые ответы — по журналу, а не по памяти процесса: serverless живёт минуты. */
  ourReplies: string[];
  /**
   * Когда человек вернул диалог боту: раньше этого момента не смотрим, иначе
   * та же реплика менеджера сразу ставит паузу заново (v1 5fe7da2).
   */
  resumedAt?: string | null;
  /**
   * Окно паузы магазина: реплика старше него не значит, что менеджер в чате.
   * Без этого вчерашний менеджер держал бота в паузе бесконечно (v1 5e31727).
   */
  pauseWindowMs?: number;
};

export type ManagerMessage = { text: string; at: number };

/** Сворачивает текст для сравнения «это наши же слова». */
export function foldReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 200);
}

export function findManagerMessage(
  messages: ZernioInboxMessage[],
  state: GuardState,
  now: number = Date.now(),
): ManagerMessage | null {
  const botAt = Date.parse(state.lastBotReplyAt ?? "");
  let since = Number.isFinite(botAt)
    ? Math.min(botAt + BOT_ECHO_GRACE_MS, now - ACTIVE_MANAGER_WINDOW_MS)
    : now - MANAGER_LOOKBACK_MS;
  if (state.pauseWindowMs && state.pauseWindowMs > 0)
    since = Math.max(since, now - state.pauseWindowMs);
  const resumed = Date.parse(state.resumedAt ?? "");
  if (Number.isFinite(resumed)) since = Math.max(since, resumed);
  const ourVoice = new Set(state.ourReplies.map(foldReply).filter(Boolean));
  const tail = messages.slice(-TAIL);
  for (let i = tail.length - 1; i >= 0; i--) {
    const m = tail[i];
    if (!m || m.direction !== "outgoing") continue;
    const text = (m.message ?? "").trim();
    if (!text) continue;
    const at = Date.parse(m.createdAt ?? "");
    if (!Number.isFinite(at) || at <= since) continue;
    if (ourVoice.has(foldReply(text))) continue;
    return { text, at };
  }
  return null;
}

/**
 * Сообщение написал человек (продавец в приложении или в инбоксе Zernio), а не
 * бот, рассылка или сценарий: `sentVia` пришёл и равен null/«human». Нет поля
 * вовсе — не знаем, считаем не человеком: ошибиться в эту сторону безопаснее
 * (бот не замолчит из-за собственных ответов).
 */
export function isPersonMessage(m: ZernioInboxMessage, ourReplies: string[] = []): boolean {
  if (m.direction !== "outgoing") return false;
  if (m.sentVia !== null && m.sentVia !== "human") return false;
  if (sentByZernioScenario(m)) return false;
  const text = (m.message ?? "").trim();
  return !(text && ourReplies.map(foldReply).includes(foldReply(text)));
}

/**
 * Сообщение ушло сценарием Zernio: автоответ на комментарий, цепочка,
 * рассылка. Это не продавец руками — паузу бота оно не ставит (Копилка
 * 09.10: первое сообщение автоответа «Палитра» ставило паузу, и бот молчал
 * на телефон и «Мне можно на ватсап» посреди оформления).
 */
export function sentByZernioScenario(m: {
  automationId?: string | null;
  workflowId?: string | null;
  sequenceId?: string | null;
  broadcastId?: string | null;
  executionId?: string | null;
}): boolean {
  return Boolean(m.automationId || m.workflowId || m.sequenceId || m.broadcastId || m.executionId);
}

/** Время последнего сообщения человека в хвосте переписки, мс; null — не писал. */
export function lastPersonMessageAt(
  messages: ZernioInboxMessage[],
  ourReplies: string[] = [],
): number | null {
  let last: number | null = null;
  for (const m of messages.slice(-TAIL)) {
    if (!isPersonMessage(m, ourReplies)) continue;
    const at = Date.parse(m.createdAt ?? "");
    if (Number.isFinite(at) && (last === null || at > last)) last = at;
  }
  return last;
}

/**
 * Продавец писал в диалог руками за последние `windowMs`. Для коротких «реплик
 * вслух» вроде «Записал ваш номер»: вмешиваться в живую переписку не нужно.
 */
export function sellerWroteWithin(
  messages: ZernioInboxMessage[],
  windowMs: number,
  ourReplies: string[] = [],
  now: number = Date.now(),
): boolean {
  const at = lastPersonMessageAt(messages, ourReplies);
  return at !== null && at > now - windowMs;
}
