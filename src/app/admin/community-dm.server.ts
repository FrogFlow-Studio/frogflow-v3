import { escapeHtml } from "@/channels/telegram/copy";
import { notifyAdminsHtml } from "@/channels/telegram/notify";
import { claimDmNotice, sendDm } from "@/core/community/dm.server";
import { communityProfile } from "@/core/community/profile";
import { tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { adminTFor } from "@/app/admin/locale.server";
import { logFailure } from "@/lib/log-failure";

/**
 * Личное сообщение автору и одно уведомление ему в Telegram. Право на уведомление занимает
 * условная отметка в базе (claimDmNotice) до отправки: два вызова или повтор запроса шлют ровно
 * одно уведомление, а отправку, которая могла дойти, не повторяем. Сообщение уже сохранено, поэтому
 * сбой уведомления наружу не идёт.
 */
export async function sendCommunityDm(
  ctx: TenantContext,
  toBotId: string,
  body: unknown,
): Promise<{ id: string }> {
  const sent = await sendDm(ctx, toBotId, body);
  try {
    if (await claimDmNotice(sent.id)) {
      const rctx = tenantContext(sent.to);
      const t = await adminTFor(rctx);
      const from = escapeHtml(communityProfile(ctx.tenant.settings).name);
      await notifyAdminsHtml(rctx, t("community.dm.notice", { name: from }), { kind: "system" });
    }
  } catch (e) {
    logFailure("community-dm.notifyAuthor", e, { botId: ctx.tenant.id });
  }
  return { id: sent.id };
}
