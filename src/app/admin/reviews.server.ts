import type { TenantContext } from "@/core/tenant/resolve.server";
import { getCustomerByTelegramId } from "@/core/customers/customers";
import { isLocale } from "@/core/i18n/locale";
import type { AdminReview } from "@/core/reviews/admin";
import { COPY, escapeHtml } from "@/channels/telegram/copy";
import { adminTelegramApi } from "@/channels/telegram/notify";

/**
 * Ответ продавца на отзыв — личным сообщением покупателю в его канал:
 * Telegram от бота магазина, Instagram/WhatsApp — в тот же диалог Zernio.
 * Язык подписи — покупателя (как у листа ожидания). false — не доставлено.
 */
export async function sendReviewReply(
  ctx: TenantContext,
  review: AdminReview,
  reply: string,
): Promise<boolean> {
  const c = await getCustomerByTelegramId(ctx, review.buyer.telegramId);
  if (!c) return false;
  const locale = isLocale(c.state.locale)
    ? c.state.locale
    : (ctx.tenant.settings.default_locale ?? "ru");
  const text = COPY[locale].reviewReply(
    escapeHtml(review.productName ?? "—"),
    escapeHtml(reply.trim()),
  );
  if (c.platform === "telegram") {
    const api = adminTelegramApi(ctx);
    if (!api) return false;
    const r = await api.call("sendMessage", {
      chat_id: c.telegramId,
      text,
      parse_mode: "HTML",
    });
    return r.ok;
  }
  const { sendToZernioTarget, zernioTargetOf } = await import("@/channels/zernio/outbound.server");
  const target = zernioTargetOf(c);
  return target ? sendToZernioTarget(target, text) : false;
}
