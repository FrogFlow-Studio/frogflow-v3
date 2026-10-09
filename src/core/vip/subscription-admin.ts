import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import {
  formatDateTime,
  inviteExpireDate,
  isAlreadyNotInChat,
  resolveVipExtension,
  TEST_MODE_DEFAULT_MINUTES,
} from "./pure";
import { type MemberUser, type VipGroup, esc, isMember, vipSettings } from "./vip-model";
import { assignMemberTariff, getTariff } from "./tariffs";
import { getSubscription } from "./subscription-queries";
import { expireOtherActives, latestActiveExpiry } from "./subscription-payment";

/** Доступ вручную: выдача, продление, инвайт, исключение, удаление. */

/** Инвайт и уведомление после ручной активации из админки. */
async function grantAccess(
  ctx: TenantContext,
  group: VipGroup,
  p: { id: string; telegramId: number; expiresAt: Date; groupId: string; welcome: string },
): Promise<{ inGroup: boolean; inviteSent: boolean; deliveryFailed: boolean }> {
  const inGroup = await isMember(group, p.groupId, p.telegramId);
  let link: string | null = null;
  if (!inGroup) {
    link = await group.createInvite(
      p.groupId,
      `vip-man-${p.id.slice(0, 8)}`,
      inviteExpireDate(p.expiresAt),
    );
    if (!link)
      throw new UserError(
        "err.vip.inviteFailed",
        "Не удалось создать ссылку-приглашение. Убедитесь, что бот — админ группы.",
      );
  }
  const { error } = await ctx.db
    .from("vip_subscriptions")
    .update({ group_invite_link: link })
    .eq("id", p.id);
  if (error) {
    if (link) await group.revokeInvite(p.groupId, link);
    throw new UserError("err.vip.linkSaveFailed", "Ошибка сохранения ссылки: {error}", {
      error: error.message,
    });
  }
  const until = esc(formatDateTime(p.expiresAt, ctx.timezone));
  const sent = await group.send(
    p.telegramId,
    inGroup
      ? `✅ ${esc(p.welcome)}\n\nПодписка оформлена администратором до: <b>${until}</b>\n\nВы уже в VIP-группе — новая ссылка не нужна.`
      : `✅ ${esc(p.welcome)}\n\nПодписка оформлена администратором до: <b>${until}</b>\n\nВаша персональная одноразовая ссылка для вступления:\n${link}`,
  );
  return { inGroup, inviteSent: Boolean(link), deliveryFailed: !sent };
}

/**
 * Предупреждения ручного добавления — кодами: ядро не знает языка админки,
 * текст на языке продавца собирает серверный слой панели.
 */
export type ManualWarning = "notInGroup" | "noGroup" | "undelivered";

export async function addManualSubscription(
  ctx: TenantContext,
  group: VipGroup,
  p: { telegramId: number; tariffId: string; days?: number; status: "active" | "expired" },
): Promise<{ ok: true; warning?: string; warningKeys: ManualWarning[] }> {
  const settings = await vipSettings(ctx);
  const tariff = await getTariff(ctx, p.tariffId);
  if (!tariff) throw new UserError("err.vip.tariffNotFound", "Тариф не найден");
  const now = new Date();
  const expiresAt = new Date(now);
  if (settings.testMode)
    expiresAt.setMinutes(
      expiresAt.getMinutes() + (tariff.duration_minutes || TEST_MODE_DEFAULT_MINUTES),
    );
  else expiresAt.setDate(expiresAt.getDate() + (p.days ?? tariff.duration_days ?? 30));

  let user: MemberUser = {};
  let warning: string | undefined;
  const warningKeys: ManualWarning[] = [];
  if (settings.groupId) {
    const m = await group.member(settings.groupId, p.telegramId);
    if (m?.user) user = m.user;
    else {
      warning =
        "Пользователь не найден в VIP-группе. Подписка создана; ссылка уйдёт, если он писал боту.";
      warningKeys.push("notInGroup");
    }
  }
  if (p.status === "active")
    await expireOtherActives(ctx, group, p.telegramId, undefined, settings.groupId);
  const { data: inserted, error } = await ctx.db
    .from("vip_subscriptions")
    .insert({
      bot_id: ctx.tenant.id,
      telegram_id: p.telegramId,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      tariff_id: p.tariffId,
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: p.status,
      imported: true,
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? "insert failed");
  if (p.status === "active") {
    if (!settings.groupId) {
      warning = `${warning ? `${warning} ` : ""}VIP-группа не настроена — инвайт не отправлен.`;
      warningKeys.push("noGroup");
    } else {
      const r = await grantAccess(ctx, group, {
        id: inserted.id,
        telegramId: p.telegramId,
        expiresAt,
        groupId: settings.groupId,
        welcome: settings.welcome,
      });
      if (r.deliveryFailed) {
        warning = `${warning ? `${warning} ` : ""}Сообщение пользователю не доставлено (не писал боту или заблокировал). Ссылка сохранена — используйте «Переотправить».`;
        warningKeys.push("undelivered");
      }
    }
  }
  if (tariff.is_public === false && !tariff.is_entry)
    await assignMemberTariff(ctx, p.telegramId, user, tariff.id, "admin");
  return { ok: true, warning, warningKeys };
}

export async function extendSubscription(
  ctx: TenantContext,
  group: VipGroup,
  id: string,
  days: number,
): Promise<{ ok: true; expired: boolean; expiresAt: string }> {
  if (!Number.isInteger(days) || days === 0)
    throw new UserError("err.vip.daysNonZero", "Укажите число дней, отличное от нуля");
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  const { groupId } = await vipSettings(ctx);
  const { wasInactive, baseSafe, shortenedPast } = resolveVipExtension(sub, days);
  if (days < 0 && wasInactive)
    throw new UserError(
      "err.vip.cannotShortenExpired",
      "Нельзя уменьшить истёкшую подписку. Сначала продлите или создайте новую.",
    );
  let link = sub.group_invite_link;

  if (shortenedPast) {
    if (link && groupId) await group.revokeInvite(groupId, link);
    const { error } = await ctx.db
      .from("vip_subscriptions")
      .update({
        expires_at: baseSafe.toISOString(),
        status: "expired",
        admin_note: "admin_shortened",
        group_invite_link: null,
      })
      .eq("id", id);
    if (error) throw serverFailure(error.message);
    const other = await latestActiveExpiry(ctx, sub.telegram_id, id);
    if (!other && groupId) await group.kick(groupId, sub.telegram_id);
    await group.send(
      sub.telegram_id,
      `ℹ️ Срок VIP изменён администратором.\n\nПодписка завершена <b>${esc(formatDateTime(baseSafe, ctx.timezone))}</b>.${other ? "" : "\nДоступ к группе закрыт."}`,
    );
    return { ok: true, expired: true, expiresAt: baseSafe.toISOString() };
  }

  const until = esc(formatDateTime(baseSafe, ctx.timezone));
  let notify: string;
  if (wasInactive && groupId) {
    if (await isMember(group, groupId, sub.telegram_id)) {
      if (link) await group.revokeInvite(groupId, link);
      link = null;
      notify = `✅ Подписка продлена до <b>${until}</b>\n\nВы уже в VIP-группе — новая ссылка не нужна.`;
    } else {
      if (link) await group.revokeInvite(groupId, link);
      link = await group.createInvite(
        groupId,
        `vip-ext-${id.slice(0, 8)}`,
        inviteExpireDate(baseSafe),
      );
      if (!link)
        throw new UserError(
          "err.vip.inviteFailed",
          "Не удалось создать ссылку-приглашение. Убедитесь, что бот — админ группы.",
        );
      notify = `✅ Подписка продлена до <b>${until}</b>\n\nОдноразовая ссылка для вступления:\n${link}`;
    }
  } else {
    notify = `✅ Ваша VIP подписка ${days > 0 ? "продлена" : "изменена"} до <b>${until}</b>.`;
  }
  if (wasInactive) await expireOtherActives(ctx, group, sub.telegram_id, id, groupId);
  const { error } = await ctx.db
    .from("vip_subscriptions")
    .update({
      expires_at: baseSafe.toISOString(),
      status: "active",
      admin_note: null,
      group_invite_link: link,
    })
    .eq("id", id);
  if (error) throw serverFailure(error.message);
  await group.send(sub.telegram_id, notify);
  return { ok: true, expired: false, expiresAt: baseSafe.toISOString() };
}

/** Новая ссылка для активной подписки, чей инвайт до покупателя не дошёл. */
export async function resendInvite(ctx: TenantContext, group: VipGroup, id: string): Promise<void> {
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  if (sub.status !== "active")
    throw new UserError(
      "err.vip.resendOnlyActive",
      "Переотправить ссылку можно только для активной подписки",
    );
  const { groupId } = await vipSettings(ctx);
  if (!groupId) throw new UserError("err.vip.groupIdMissing", "Не настроен ID VIP-группы");
  if (await isMember(group, groupId, sub.telegram_id))
    throw new UserError(
      "err.vip.alreadyInGroup",
      "Пользователь уже состоит в VIP-группе — ссылка не нужна",
    );
  if (sub.group_invite_link) await group.revokeInvite(groupId, sub.group_invite_link);
  const expiresAt = new Date(sub.expires_at);
  const link = await group.createInvite(
    groupId,
    `vip-resend-${id.slice(0, 8)}`,
    inviteExpireDate(expiresAt),
  );
  if (!link)
    throw new UserError(
      "err.vip.inviteFailed",
      "Не удалось создать ссылку-приглашение. Убедитесь, что бот — админ группы.",
    );
  const { error } = await ctx.db
    .from("vip_subscriptions")
    .update({ group_invite_link: link })
    .eq("id", id);
  if (error) {
    await group.revokeInvite(groupId, link);
    throw new UserError("err.vip.linkSaveFailed", "Ошибка сохранения ссылки: {error}", {
      error: error.message,
    });
  }
  const sent = await group.send(
    sub.telegram_id,
    `🔁 Ссылка для вступления в VIP-группу переотправлена администратором.\n\nСрок действия подписки до: <b>${esc(formatDateTime(expiresAt, ctx.timezone))}</b>\n\nОдноразовая ссылка:\n${link}`,
  );
  if (!sent)
    throw new UserError(
      "err.vip.resendUndelivered",
      "Ссылка создана и сохранена, но сообщение не доставлено — возможно, пользователь заблокировал бота.",
    );
}

/** Исключить из группы и закрыть доступ; история остаётся (expired). */
export async function excludeMember(
  ctx: TenantContext,
  group: VipGroup,
  id: string,
): Promise<void> {
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  const { groupId } = await vipSettings(ctx);
  if (!groupId) throw new UserError("err.vip.groupIdMissing", "Не настроен ID VIP-группы");
  const { data: rows, error: rowsError } = await ctx.db
    .from("vip_subscriptions")
    .select("id, group_invite_link")
    .eq("telegram_id", sub.telegram_id)
    .in("status", ["active", "pending_payment"]);
  if (rowsError) throw serverFailure(`VIP: ссылки участника: ${rowsError.message}`);
  for (const r of rows ?? [])
    if (r.group_invite_link) await group.revokeInvite(groupId, r.group_invite_link);
  const ban = await group.kick(groupId, sub.telegram_id);
  if (!ban.ok && !isAlreadyNotInChat(ban.description))
    throw ban.description
      ? new Error(ban.description)
      : new UserError(
          "err.vip.kickFailed",
          "Не удалось исключить из группы (бот админ? право ban users?)",
        );
  const closed = await ctx.db
    .from("vip_subscriptions")
    .update({ status: "expired", group_invite_link: null, admin_note: "admin_excluded" })
    .eq("telegram_id", sub.telegram_id)
    .eq("status", "active");
  if (closed.error) throw serverFailure(`VIP: доступ не закрыт: ${closed.error.message}`);
  const dropped = await ctx.db
    .from("vip_subscriptions")
    .update({ status: "cancelled", group_invite_link: null })
    .eq("telegram_id", sub.telegram_id)
    .eq("status", "pending_payment");
  if (dropped.error) throw serverFailure(`VIP: заявка не отменена: ${dropped.error.message}`);
  await group.send(
    sub.telegram_id,
    "❌ <b>Доступ к VIP-сообществу отозван администратором.</b>\n\nВы исключены из группы. Чтобы вернуться — оформите подписку заново в боте.",
  );
}

export async function deleteSubscription(
  ctx: TenantContext,
  group: VipGroup,
  id: string,
): Promise<{ forgotProfile: boolean }> {
  const sub = await getSubscription(ctx, id);
  if (!sub) throw new UserError("err.vip.subscriptionNotFound", "Подписка не найдена");
  const { groupId } = await vipSettings(ctx);
  if (groupId && sub.group_invite_link) await group.revokeInvite(groupId, sub.group_invite_link);
  if (groupId && sub.status === "active") {
    const other = await latestActiveExpiry(ctx, sub.telegram_id, id);
    if (!other) await group.kick(groupId, sub.telegram_id);
  }
  const { error } = await ctx.db.from("vip_subscriptions").delete().eq("id", id);
  if (error) throw serverFailure(error.message);
  const { count, error: leftError } = await ctx.db
    .from("vip_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", sub.telegram_id);
  if (leftError) throw serverFailure(`VIP: остаток подписок: ${leftError.message}`);
  const forgotProfile = (count ?? 0) === 0;
  if (forgotProfile) {
    const gone = await ctx.db
      .from("vip_member_profiles")
      .delete()
      .eq("telegram_id", sub.telegram_id);
    if (gone.error) throw serverFailure(`VIP: профиль не удалён: ${gone.error.message}`);
  }
  return { forgotProfile };
}
