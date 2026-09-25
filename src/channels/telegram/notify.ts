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
export async function notifyAdminsHtml(
  ctx: TenantContext,
  html: string,
  opts: { orderId?: number; kind?: string } = {},
): Promise<number> {
  const api = adminTelegramApi(ctx);
  if (!api) return 0;
  const { sendOrEnqueue } = await import("@/core/outbox/outbox");
  const { telegramOutboxSender } = await import("./outbox");
  let sent = 0;
  for (const chatId of await adminRecipients(ctx)) {
    // Не ушло — в очередь: крон повторит, продавец не останется без заказа.
    const ok = await sendOrEnqueue(
      ctx,
      {
        kind: opts.kind ?? "admin_notice",
        target: { channel: "telegram", chatId },
        text: html,
        orderId: opts.orderId,
        audience: "admin",
      },
      telegramOutboxSender,
    );
    if (ok) sent += 1;
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
  // Повтор выдачи — в очередь: сеть или Telegram могли просто моргнуть.
  const { enqueueOutbox } = await import("@/core/outbox/outbox");
  await enqueueOutbox(
    ctx,
    {
      kind: "deliver_order",
      target: { channel: "order" },
      orderId: order.id,
      audience: "customer",
    },
    `не выдано ${r.failed} из ${r.sent + r.failed}`,
  );
  return notifyAdminsHtml(
    ctx,
    `⚠️ Заказ #${no}: не выдано ${r.failed} из ${r.sent + r.failed} поз. ` +
      `Повторим сами через несколько минут; если не поможет — проверьте файлы товара и нажмите «Подтвердить и выдать» в карточке заказа.`,
    { orderId: order.id, kind: "delivery_failure" },
  );
}
