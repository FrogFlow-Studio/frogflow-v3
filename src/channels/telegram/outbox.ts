import type { OutboxSender } from "@/core/outbox/outbox";
import { adminTelegramApi } from "./notify";

/** Исходящее в Telegram из очереди: текст HTML тому chat_id, что записан в строке. */
export const telegramOutboxSender: OutboxSender = async (ctx, msg) => {
  if (msg.target.channel !== "telegram") return { ok: false, error: "не Telegram" };
  const api = adminTelegramApi(ctx);
  if (!api) return { ok: false, error: "бот Telegram не подключён" };
  const r = await api.call("sendMessage", {
    chat_id: msg.target.chatId,
    text: msg.text ?? "",
    parse_mode: "HTML",
  });
  return r.ok ? { ok: true } : { ok: false, error: r.description ?? "sendMessage failed" };
};
