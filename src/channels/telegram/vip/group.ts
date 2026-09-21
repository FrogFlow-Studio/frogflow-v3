import type { TelegramApi } from "../api";
import type { VipGroup } from "@/core/vip/vip";

/** Группа глазами ядра — через Bot API VIP-бота клиента (он админ группы). */
export function vipGroupApi(api: TelegramApi): VipGroup {
  return {
    async member(groupId, telegramId) {
      const r = await api.call<{
        status?: string;
        user?: { id: number; username?: string; first_name?: string; last_name?: string };
      }>("getChatMember", { chat_id: groupId, user_id: telegramId });
      if (!r.ok || !r.result?.status) return null;
      return { status: r.result.status, user: r.result.user };
    },
    async createInvite(groupId, name, expireDate) {
      const r = await api.call<{ invite_link?: string }>("createChatInviteLink", {
        chat_id: groupId,
        member_limit: 1,
        name,
        expire_date: expireDate,
      });
      return r.ok ? (r.result?.invite_link ?? null) : null;
    },
    async revokeInvite(groupId, link) {
      if (!groupId || !link) return;
      await api.call("revokeChatInviteLink", { chat_id: groupId, invite_link: link });
    },
    async kick(groupId, telegramId) {
      const ban = await api.call("banChatMember", {
        chat_id: groupId,
        user_id: telegramId,
        revoke_messages: false,
      });
      if (ban.ok)
        await api.call("unbanChatMember", {
          chat_id: groupId,
          user_id: telegramId,
          only_if_banned: true,
        });
      return { ok: ban.ok, description: ban.description };
    },
    async send(telegramId, html) {
      const r = await api.call("sendMessage", {
        chat_id: telegramId,
        text: html,
        parse_mode: "HTML",
      });
      return r.ok;
    },
  };
}
