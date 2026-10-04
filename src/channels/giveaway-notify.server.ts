import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  notifyGiveaway,
  type NoticeDeps,
  type NoticeRun,
  type SendOutcome,
} from "@/core/giveaways/notify";
import { rejectedForSure } from "@/channels/telegram/api";
import { adminTelegramApi, notifyAdminsHtml } from "@/channels/telegram/notify";
import { liveTransport, type ZernioTransport } from "@/channels/zernio/api.server";
import { classifyZernioFailure } from "@/channels/zernio/errors";
import { plain } from "@/channels/zernio/shop-flow";
import { zernioTargetOf } from "@/channels/zernio/outbound.server";

/**
 * Каналы для сообщений участникам розыгрыша (core/giveaways/notify знает
 * только «отправить покупателю»). Telegram — sendMessage в чат покупателя;
 * Instagram и WhatsApp — в его диалог Zernio. Ответ разбирается так:
 * «принято» / «точно не принято» / «могло дойти». Последнее не повторяется.
 */
export function giveawayNoticeDeps(
  ctx: TenantContext,
  transport: ZernioTransport = liveTransport,
): NoticeDeps {
  return {
    async send(c, html): Promise<SendOutcome> {
      if (c.platform === "telegram") {
        const api = adminTelegramApi(ctx);
        if (!api) return "rejected";
        const r = await api.call("sendMessage", {
          chat_id: c.telegramId,
          text: html,
          parse_mode: "HTML",
        });
        if (r.ok) return "sent";
        return rejectedForSure(r) ? "rejected" : "unknown";
      }
      const target = zernioTargetOf(c, ctx.tenant.settings.default_locale);
      if (!target) return "rejected";
      const r = await transport.send(target.conversationId, target.accountId, plain(html), {
        platform: target.platform,
      });
      if (r.ok) return "sent";
      return classifyZernioFailure(r.failure) === "ambiguous" ? "unknown" : "rejected";
    },
    async notifySeller(html) {
      try {
        await notifyAdminsHtml(ctx, html, { kind: "system" });
      } catch (e) {
        console.error(`[giveaway:${ctx.tenant.id}] продавцу не отправлено`, e);
      }
    },
  };
}

export function notifyGiveawayWinners(
  ctx: TenantContext,
  giveawayId: string,
  opts: { transport?: ZernioTransport; now?: () => number; budgetMs?: number } = {},
): Promise<NoticeRun> {
  return notifyGiveaway(ctx, giveawayId, giveawayNoticeDeps(ctx, opts.transport), opts);
}
