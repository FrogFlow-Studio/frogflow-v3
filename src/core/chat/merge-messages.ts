import type { ChatMessage } from "./chat";

/**
 * Склейка уже показанной переписки со свежей страницей опроса: по id, порядок
 * (created_at, id). Загруженное через «Показать раньше» опрос не стирает, а
 * сообщения между старой и новой границей страницы не теряются.
 */
export function mergeMessages(prev: ChatMessage[], fresh: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of fresh) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1,
  );
}
