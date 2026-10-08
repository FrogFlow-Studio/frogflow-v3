import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "./api";
import type { TelegramUpdate } from "./types";
import { handleCallback } from "./update/callback";
import { handleMessage } from "./update/message";

export { sendCartMessage } from "./update/cart";
export { FREE_SEARCH_MAX, isFreeTextQuery } from "./update/catalog";
export { onOrderPaid } from "./update/payments";
import { handlePreCheckout, handleStarsPaid } from "./update/payments";

/**
 * Адаптер Telegram: разбирает обновление, зовёт ядро, рисует ответ.
 * Ни одной бизнес-проверки здесь нет — они в core/*. Канал знает про
 * клавиатуры, HTML и file_id; ядро — про корзину, заказы и цены.
 *
 * Сценарии разложены по файлам в ./update/: сообщения, кнопки, каталог,
 * корзина, оформление, оплата, заказы покупателя, сторона продавца.
 */
export async function handleTelegramUpdate(
  ctx: TenantContext,
  api: TelegramApi,
  update: TelegramUpdate,
): Promise<void> {
  try {
    if (update.callback_query) return await handleCallback(ctx, api, update.callback_query);
    if (update.pre_checkout_query)
      return await handlePreCheckout(ctx, api, update.pre_checkout_query);
    if (update.message?.successful_payment) return await handleStarsPaid(ctx, api, update.message);
    if (update.message) return await handleMessage(ctx, api, update.message);
    if (update.chat_member) {
      const { handleCourseChannelMember } = await import("./courses");
      return await handleCourseChannelMember(ctx, update.chat_member);
    }
  } catch (e) {
    const { reportError } = await import("@/lib/errors");
    await reportError(e, {
      where: "telegram.update",
      botId: ctx.tenant.id,
      extra: {
        update_id: update.update_id,
        kind: update.callback_query ? "callback" : update.message ? "message" : "other",
      },
    });
  }
}
