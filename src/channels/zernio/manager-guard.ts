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
  const since = Number.isFinite(botAt)
    ? Math.min(botAt + BOT_ECHO_GRACE_MS, now - ACTIVE_MANAGER_WINDOW_MS)
    : now - MANAGER_LOOKBACK_MS;
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
