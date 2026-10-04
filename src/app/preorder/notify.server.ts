import type { TenantContext } from "@/core/tenant/resolve.server";
import { escapeHtml, COPY, preorderDate } from "@/channels/telegram/copy";
import { adminTelegramApi, notifyAdminsHtml } from "@/channels/telegram/notify";
import { notifyPreorderMoved, type PreorderMove } from "@/core/preorder/reschedule";
import { adminTFor } from "@/app/admin/locale.server";
import { logFailure } from "@/lib/log-failure";

/**
 * Продавец перенёс срок предзаказа: покупателям с открытым заказом — по
 * сообщению в их канал (Telegram — ботом, Instagram/WhatsApp — в диалог
 * Zernio, пока открыто окно 24 часа), продавцу — список тех, кому не
 * написали. Ошибки наружу не идут: сохранение карточки уже состоялось.
 */
export async function notifyPreorderMovedChannels(
  ctx: TenantContext,
  move: PreorderMove,
  opts: { budgetMs?: number } = {},
) {
  const api = adminTelegramApi(ctx);
  const { sendToZernioTarget, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const result = await notifyPreorderMoved(
    ctx,
    move,
    async (order, locale) => {
      const text = COPY[locale].preorderMoved(escapeHtml(move.name), move.to);
      if (order.platform === "instagram" || order.platform === "whatsapp") {
        const target = await zernioTargetForOrder(ctx, {
          user_key: order.userKey,
          telegram_id: order.telegramId,
          platform: order.platform,
        });
        return target ? sendToZernioTarget(target, text) : false;
      }
      if (!api) return false;
      const r = await api.call("sendMessage", {
        chat_id: order.telegramId,
        text,
        parse_mode: "HTML",
      });
      return r.ok;
    },
    { budgetMs: opts.budgetMs },
  );
  if (result.missed.length || result.left) {
    const t = await adminTFor(ctx);
    const date = move.to
      ? preorderDate(move.to, ctx.tenant.settings.default_locale ?? "ru")
      : t("preorder.moved.noDate");
    // Не больше 200 номеров в сообщении (лимит Telegram 4096 знаков); остаток — «…».
    const numbers = (orders: typeof result.missed) =>
      orders
        .slice(0, 200)
        .map((o) => `#${o.displayNo}`)
        .join(", ") + (orders.length > 200 ? " …" : "");
    const params = { name: escapeHtml(move.name), date };
    const lines = [
      result.missed.length
        ? t("preorder.moved.missed", { ...params, n: result.missed.length })
        : "",
      result.missed.length ? numbers(result.missed) : "",
      result.left ? t("preorder.moved.left", { ...params, n: result.left }) : "",
      result.left ? numbers(result.leftOrders) : "",
    ].filter(Boolean);
    await notifyAdminsHtml(ctx, lines.join("\n"), { kind: "system" }).catch((e) =>
      logFailure("preorder-move.notifySeller", e, { botId: ctx.tenant.id }),
    );
  }
  return result;
}
