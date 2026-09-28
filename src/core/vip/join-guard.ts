import type { TenantContext } from "@/core/tenant/resolve.server";
import { memberStatusExempt, memberStatusIsInGroup } from "./pure";
import { vipSettings, type VipGroup } from "./vip";

/**
 * Защита платной VIP-группы от входа по пересланной ссылке (в v1 такого нет).
 * Ссылки мы создаём одноразовыми (member_limit 1) с именем
 * `vip-<8 символов id подписки>` (также vip-man-, vip-ext- и vip-resend-
 * у «Переотправить ссылку»), но по ней
 * может войти любой, кому покупатель её переслал, — и сам покупатель тогда
 * уже не войдёт. Telegram присылает VIP-боту chat_member с ссылкой, по
 * которой вошли: если вошёл не владелец подписки и у него нет своей
 * активной подписки — выгоняем, ссылку отзываем, продавцу сообщаем. Вход не
 * по нашей ссылке (добавил админ, публичная ссылка продавца) не трогаем.
 */
export type ChatMemberUpdate = {
  chat?: { id?: number | string };
  from?: { id?: number };
  old_chat_member?: { status?: string };
  new_chat_member?: {
    status?: string;
    user?: { id?: number; username?: string; first_name?: string; is_bot?: boolean };
  };
  invite_link?: { invite_link?: string; name?: string };
};

const LINK_NAME = /^vip-(?:man-|ext-|resend-)?([0-9a-f]{8})$/i;

/** Префикс id подписки из имени нашей ссылки; null — ссылка не наша. */
export function vipLinkPrefix(name: string | undefined): string | null {
  const m = LINK_NAME.exec(name ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

export type JoinVerdict =
  | { action: "ignore"; reason: string }
  | { action: "allow"; reason: string }
  | {
      action: "kick";
      userId: number;
      who: string;
      link: string | null;
      /** Чья это была ссылка, если нашли подписку по ссылке. */
      ownerId: number | null;
    };

/** Решение по входу; ничего не меняет. */
export async function judgeVipJoin(
  ctx: TenantContext,
  u: ChatMemberUpdate,
  now = new Date(),
): Promise<JoinVerdict> {
  const status = u.new_chat_member?.status;
  const user = u.new_chat_member?.user;
  if (!user?.id || user.is_bot) return { action: "ignore", reason: "нет пользователя" };
  if (!memberStatusIsInGroup(status) || memberStatusIsInGroup(u.old_chat_member?.status))
    return { action: "ignore", reason: "не вход в группу" };
  if (memberStatusExempt(status)) return { action: "ignore", reason: "админ группы" };
  const prefix = vipLinkPrefix(u.invite_link?.name);
  if (!prefix) return { action: "ignore", reason: "вход не по ссылке подписки" };
  const { groupId } = await vipSettings(ctx);
  if (!groupId || String(u.chat?.id ?? "") !== groupId)
    return { action: "ignore", reason: "не VIP-группа магазина" };

  const { data, error } = await ctx.db
    .from("vip_subscriptions")
    .select("id, status, expires_at")
    .eq("telegram_id", user.id);
  // Не прочитали подписки — не выгоняем: ошибка базы не повод трогать платящего.
  if (error) return { action: "allow", reason: `подписки не прочитаны: ${error.message}` };
  const own = data ?? [];
  if (own.some((s) => s.id.toLowerCase().startsWith(prefix)))
    return { action: "allow", reason: "владелец ссылки" };
  if (own.some((s) => s.status === "active" && Date.parse(s.expires_at) > now.getTime()))
    return { action: "allow", reason: "своя активная подписка" };

  const link = u.invite_link?.invite_link ?? null;
  let ownerId: number | null = null;
  if (link) {
    const { data: owner, error: ownerErr } = await ctx.db
      .from("vip_subscriptions")
      .select("telegram_id")
      .eq("group_invite_link", link)
      .limit(1)
      .maybeSingle();
    // Владельца не нашли — выгоняем всё равно, в уведомлении просто без его id.
    if (ownerErr) console.warn(`[vip:${ctx.tenant.id}] владелец ссылки не прочитан`, ownerErr);
    ownerId = owner?.telegram_id ?? null;
  }
  const who = user.username ? `@${user.username}` : user.first_name || String(user.id);
  return { action: "kick", userId: user.id, who, link, ownerId };
}

/**
 * Разобрать chat_member VIP-группы: выгнать вошедшего по чужой ссылке,
 * отозвать ссылку, уведомить продавца (`notify`, HTML). Отозванную ссылку
 * владелец получит заново кнопкой «Переотправить ссылку» у продавца.
 */
export async function guardVipJoin(
  ctx: TenantContext,
  group: VipGroup,
  u: ChatMemberUpdate,
  notify: (html: string) => Promise<void>,
): Promise<JoinVerdict> {
  const v = await judgeVipJoin(ctx, u);
  if (v.action !== "kick") return v;
  const { groupId } = await vipSettings(ctx);
  const kicked = await group.kick(groupId, v.userId);
  if (v.link) await group.revokeInvite(groupId, v.link);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Нет права банить (или Telegram отказал) — не пишем «исключён»: продавцу исключать вручную.
  const outcome = kicked.ok
    ? "исключён, ссылка отозвана."
    : `исключить не удалось (${esc(kicked.description ?? "Telegram отказал")}) — дайте боту право банить участников и исключите его вручную. Ссылка отозвана.`;
  await notify(
    `🚫 <b>Вход в VIP-группу по чужой ссылке</b>\n👤 ${esc(v.who)} (id ${v.userId}) вошёл по ссылке ${
      v.ownerId ? `подписчика id ${v.ownerId}` : "подписки"
    } без своей подписки — ${outcome}\n\nЕсли владелец ссылки ещё не в группе, нажмите у его подписки «Переотправить ссылку».`,
  );
  return v;
}
