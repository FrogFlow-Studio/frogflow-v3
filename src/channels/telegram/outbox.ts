import type { OutboxFailure, OutboxSender } from "@/core/outbox/outbox";
import type { TgResult } from "./api";
import { adminTelegramApi } from "./notify";

/**
 * Итог отправки в Telegram для очереди исходящих. Ответа с кодом нет (обрыв,
 * тайм-аут, 5xx) — Telegram мог принять сообщение: повторять нельзя, второе
 * такое же сообщение хуже тишины (CLAUDE.md, «Внешние вызовы»). Сверить
 * историю чата Bot API не даёт, поэтому строка сразу уходит в «не доставлено»
 * с пометкой, что проверить чат должен продавец. Отказ с кодом (400, 403,
 * 429) идёт по обычным правилам очереди.
 */
export function telegramOutboxResult(r: TgResult): { ok: true } | ({ ok: false } & OutboxFailure) {
  if (r.ok) return { ok: true };
  const error = r.description ?? "sendMessage failed";
  if (r.error_code === undefined)
    return { ok: false, error: `Возможно доставлено, проверьте чат: ${error}`, permanent: true };
  return { ok: false, error };
}

/** Исходящее в Telegram из очереди: текст HTML тому chat_id, что записан в строке. */
export const telegramOutboxSender: OutboxSender = async (ctx, msg) => {
  if (msg.target.channel !== "telegram") return { ok: false, error: "не Telegram" };
  const api = adminTelegramApi(ctx);
  if (!api) return { ok: false, error: "бот Telegram не подключён" };
  return telegramOutboxResult(
    await api.call("sendMessage", {
      chat_id: msg.target.chatId,
      text: msg.text ?? "",
      parse_mode: "HTML",
    }),
  );
};
