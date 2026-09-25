import { env } from "@/config/env";
import { adminRecipients } from "@/core/notify/recipients";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { telegramApi, type TelegramApi } from "./api";

/** Telegram-бот клиента для уведомлений продавцу; null — Telegram не подключён. */
export function adminTelegramApi(ctx: TenantContext): TelegramApi | null {
  if (!ctx.tenant.telegramTokenEnc) return null;
  return telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
}

/**
 * Уведомление продавцу в Telegram (HTML) — из любого канала: заявка от
 * консультанта в Instagram тоже приходит владельцу в Telegram. Без токена
 * бота уведомить некуда — молча пропускаем, отправитель это не ошибка.
 */
export async function notifyAdminsHtml(ctx: TenantContext, html: string): Promise<number> {
  const api = adminTelegramApi(ctx);
  if (!api) return 0;
  let sent = 0;
  for (const chatId of await adminRecipients(ctx)) {
    const r = await api.call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML" });
    if (r.ok) sent += 1;
  }
  return sent;
}

/**
 * Автоматическая выдача не прошла (оплата без человека: OCR, Robokassa,
 * скидки в ноль) — продавец должен узнать сразу, а не когда покупатель
 * пожалуется. Заказ остаётся «на подтверждении» с пометкой в заметке.
 */
export async function notifyDeliveryFailure(
  ctx: TenantContext,
  order: { id: number; display_no: number | null; order_no: number },
  r: { sent: number; failed: number },
): Promise<number> {
  const no = order.display_no ?? order.order_no;
  return notifyAdminsHtml(
    ctx,
    `⚠️ Заказ #${no}: не выдано ${r.failed} из ${r.sent + r.failed} поз. ` +
      `Проверьте файлы товара и нажмите «Подтвердить и выдать» в карточке заказа — выдача продолжится с невыданных.`,
  );
}
