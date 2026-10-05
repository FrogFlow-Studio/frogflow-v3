import type { TenantContext } from "@/core/tenant/resolve.server";
import { isLocale } from "@/core/i18n/locale";
import { notifyWaitlist, type WaitlistRun } from "@/core/waitlist/waitlist";
import { COPY, escapeHtml } from "@/channels/telegram/copy";
import { adminTelegramApi } from "@/channels/telegram/notify";

/**
 * Рассылка листа ожидания по каналам: Telegram — сообщением с кнопкой на
 * карточку, Instagram/WhatsApp — в тот же диалог Zernio. Язык — покупателя.
 */
export async function notifyBackInStock(
  ctx: TenantContext,
  product: { id: string; name: string },
  opts: { budgetMs?: number } = {},
): Promise<WaitlistRun> {
  if (!ctx.tenant.modules.waitlist) return { notified: 0, failed: 0, left: 0 };
  const api = adminTelegramApi(ctx);
  const { sendToZernioTarget, zernioTargetOf } = await import("@/channels/zernio/outbound.server");
  return notifyWaitlist(
    ctx,
    product.id,
    async (c) => {
      const locale = isLocale(c.state.locale)
        ? c.state.locale
        : (ctx.tenant.settings.default_locale ?? "ru");
      const m = COPY[locale];
      const text = m.backInStock(escapeHtml(product.name));
      if (c.platform === "telegram") {
        if (!api) return false;
        const r = await api.call("sendMessage", {
          chat_id: c.telegramId,
          text,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: m.addToCartBtn, callback_data: `prod:${product.id}` }]],
          },
        });
        return r.ok;
      }
      const target = zernioTargetOf(c);
      return target ? sendToZernioTarget(target, text) : false;
    },
    { budgetMs: opts.budgetMs },
  );
}
