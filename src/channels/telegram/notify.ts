import { env } from "@/config/env";
import { adminRecipients } from "@/core/notify/recipients";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { telegramApi } from "./api";

/**
 * Уведомление продавцу в Telegram (HTML) — из любого канала: заявка от
 * консультанта в Instagram тоже приходит владельцу в Telegram. Без токена
 * бота уведомить некуда — молча пропускаем, отправитель это не ошибка.
 */
export async function notifyAdminsHtml(ctx: TenantContext, html: string): Promise<number> {
  if (!ctx.tenant.telegramTokenEnc) return 0;
  const api = telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
  let sent = 0;
  for (const chatId of await adminRecipients(ctx)) {
    const r = await api.call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML" });
    if (r.ok) sent += 1;
  }
  return sent;
}
