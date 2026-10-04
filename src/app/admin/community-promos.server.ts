import { escapeHtml } from "@/channels/telegram/copy";
import { notifyAdminsHtml } from "@/channels/telegram/notify";
import { claimInviteNotice, createJointPromo } from "@/core/community/joint.server";
import { communityProfile } from "@/core/community/profile";
import { tenantContext, tenantDirectory, type TenantContext } from "@/core/tenant/resolve.server";
import { adminTFor } from "@/app/admin/locale.server";

/**
 * Предложить акцию и позвать участников: каждому приглашённому — одно уведомление в Telegram. Право
 * на него занимает условная отметка `notified_at` до отправки (два вызова или повтор шлют одно), а
 * отправку, которая могла дойти, не повторяем. Акция уже сохранена, поэтому сбой уведомления
 * наружу не идёт.
 */
export async function proposeJointPromo(
  ctx: TenantContext,
  input: Parameters<typeof createJointPromo>[1],
): Promise<{ id: string }> {
  const made = await createJointPromo(ctx, input);
  const dir = await tenantDirectory();
  const from = escapeHtml(communityProfile(ctx.tenant.settings).name);
  const title = escapeHtml(
    String(input.title ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80),
  );
  for (const botId of made.invited) {
    try {
      const partner = dir.find((t) => t.id === botId);
      if (!partner || !(await claimInviteNotice(made.id, botId))) continue;
      const pctx = tenantContext(partner);
      const t = await adminTFor(pctx);
      await notifyAdminsHtml(pctx, t("community.joint.notice", { name: from, title }), {
        kind: "system",
      });
    } catch (e) {
      console.error(`[community-joint:${ctx.tenant.id}] уведомление ${botId}`, e);
    }
  }
  return { id: made.id };
}
