import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  addWarnOffset,
  formatDateTime,
  isAlreadyNotInChat,
  memberStatusExempt,
  pickLatestPerUser,
  WARN_STAGE_1,
  WARN_STAGE_2,
} from "./pure";
import { vipSettings, type VipGroup } from "./vip";

export type VipCronResult = {
  warned: number;
  warned2: number;
  expired: number;
  kickFailed: number;
  errors: string[];
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Напоминания об истечении (два окна) и исключение истёкших. Запись в базу
 * — ДО уведомления: если запись сорвётся, строка останется active с прошлой
 * датой, и следующий тик повторит попытку, а не будет слать «истекла»
 * вечно уже исключённому.
 */
export async function runVipCron(
  ctx: TenantContext,
  group: VipGroup,
  botUsername: string | null,
  now = new Date(),
): Promise<VipCronResult> {
  const r: VipCronResult = { warned: 0, warned2: 0, expired: 0, kickFailed: 0, errors: [] };
  const s = await vipSettings(ctx);
  if (!s.groupId) throw new Error("vip_group_id не настроен в настройках VIP");
  const t1 = addWarnOffset(now, s.warnDays, s.testMode).toISOString();
  const t2 = addWarnOffset(now, s.warnDays2, s.testMode).toISOString();
  const nowIso = now.toISOString();

  const renew = botUsername
    ? `\n\nПродлить: https://t.me/${botUsername.replace(/^@/, "")}?start=renew`
    : "\n\nНажмите /start renew в этом боте, чтобы выбрать тариф.";
  const warn = async (telegramId: number, expiresAt: string, stage: 1 | 2) => {
    const when = esc(formatDateTime(expiresAt, ctx.timezone));
    const text =
      stage === 1
        ? `⚠️ <b>Напоминание</b>\n\nВаша VIP подписка истекает <b>${when}</b>.\n\nПродлите подписку заранее, чтобы не потерять доступ к группе.`
        : `🚨 <b>Срочно!</b>\n\nВаша VIP подписка истекает уже <b>${when}</b>!\n\nПродлите сейчас — иначе доступ к группе будет закрыт.`;
    return group.send(telegramId, text + renew);
  };

  const { data: stage1 } = await ctx.db
    .from("vip_subscriptions")
    .select("*")
    .eq("status", "active")
    .lte("expires_at", t1)
    .gt("expires_at", nowIso)
    .is("admin_note", null);
  for (const sub of pickLatestPerUser(stage1 ?? [])) {
    try {
      if (await warn(sub.telegram_id, sub.expires_at, 1)) {
        await ctx.db
          .from("vip_subscriptions")
          .update({ admin_note: WARN_STAGE_1 })
          .eq("id", sub.id);
        r.warned++;
      } else r.errors.push(`warn1 ${sub.telegram_id}: send failed`);
    } catch (e) {
      r.errors.push(`warn1 ${sub.telegram_id}: ${(e as Error).message}`);
    }
  }

  const { data: stage2 } = await ctx.db
    .from("vip_subscriptions")
    .select("*")
    .eq("status", "active")
    .lte("expires_at", t2)
    .gt("expires_at", nowIso)
    .eq("admin_note", WARN_STAGE_1);
  for (const sub of pickLatestPerUser(stage2 ?? [])) {
    try {
      if (await warn(sub.telegram_id, sub.expires_at, 2)) {
        await ctx.db
          .from("vip_subscriptions")
          .update({ admin_note: WARN_STAGE_2 })
          .eq("id", sub.id);
        r.warned2++;
      } else r.errors.push(`warn2 ${sub.telegram_id}: send failed`);
    } catch (e) {
      r.errors.push(`warn2 ${sub.telegram_id}: ${(e as Error).message}`);
    }
  }

  const { data: toExpire } = await ctx.db
    .from("vip_subscriptions")
    .select("*")
    .eq("status", "active")
    .lte("expires_at", nowIso);
  for (const sub of toExpire ?? []) {
    try {
      const close = async () => {
        if (sub.group_invite_link) await group.revokeInvite(s.groupId, sub.group_invite_link);
        const { error } = await ctx.db
          .from("vip_subscriptions")
          .update({ status: "expired", group_invite_link: null })
          .eq("id", sub.id);
        if (error) throw new Error(`expire-write: ${error.message}`);
        r.expired++;
      };
      const { count: otherActive } = await ctx.db
        .from("vip_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("telegram_id", sub.telegram_id)
        .eq("status", "active")
        .gt("expires_at", nowIso)
        .neq("id", sub.id);
      if ((otherActive ?? 0) > 0) {
        await close();
        continue;
      }
      const m = await group.member(s.groupId, sub.telegram_id);
      if (memberStatusExempt(m?.status)) {
        await close();
        continue;
      }
      const ban = await group.kick(s.groupId, sub.telegram_id);
      if (!ban.ok && !isAlreadyNotInChat(ban.description)) {
        r.kickFailed++;
        r.errors.push(`kick ${sub.telegram_id}: ${ban.description || "ban failed"}`);
        continue;
      }
      await close();
      await group.send(
        sub.telegram_id,
        "❌ <b>Ваша VIP подписка истекла!</b>\n\nВы были исключены из VIP группы. Чтобы вернуться, оформите новую подписку в боте.",
      );
    } catch (e) {
      r.errors.push(`expire ${sub.telegram_id}: ${(e as Error).message}`);
    }
  }
  return r;
}
