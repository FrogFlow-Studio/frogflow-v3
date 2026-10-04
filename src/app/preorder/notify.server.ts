import type { TenantContext } from "@/core/tenant/resolve.server";
import { escapeHtml, COPY, preorderDate } from "@/channels/telegram/copy";
import { adminTelegramApi, notifyAdminsHtml } from "@/channels/telegram/notify";
import { notifyPreorderMoved, type PreorderMove } from "@/core/preorder/reschedule";
import { adminTFor } from "@/app/admin/locale.server";

/**
 * Продавец перенёс срок предзаказа: покупателям с открытым заказом — по
 * сообщению в их канал (Telegram — ботом, Instagram/WhatsApp — в диалог
 * Zernio, пока открыто окно 24 часа), продавцу — список тех, кому не
 * написали. Ошибки наружу не идут: сохранение карточки уже состоялось.
 */
export async function notifyPreorderMovedChannels(ctx: TenantContext, move: PreorderMove) {
  const api = adminTelegramApi(ctx);
  const { sendToZernioTarget, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const result = await notifyPreorderMoved(ctx, move, async (order, locale) => {
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
  });
  if (result.missed.length || result.left) {
    const t = await adminTFor(ctx);
    const date = move.to
      ? preorderDate(move.to, ctx.tenant.settings.default_locale ?? "ru")
      : t("preorder.moved.noDate");
    const lines = [
      t("preorder.moved.missed", {
        name: escapeHtml(move.name),
        date,
        n: result.missed.length,
      }),
      result.missed.map((o) => `#${o.displayNo}`).join(", "),
      result.left ? t("preorder.moved.left", { n: result.left }) : "",
    ].filter(Boolean);
    await notifyAdminsHtml(ctx, lines.join("\n"), { kind: "system" }).catch((e) =>
      console.error(`[preorder-move:${ctx.tenant.id}] список продавцу`, e),
    );
  }
  return result;
}
