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

/** Счётчик — подсказка на странице: дольше ждать Telegram страница не будет. */
export const MEMBER_COUNT_BUDGET_MS = 5_000;

/**
 * Сколько людей в группе по Telegram (getChatMemberCount): вместе с админами
 * и ботами. null — Telegram не ответил за MEMBER_COUNT_BUDGET_MS или бот не
 * в группе: «не удалось узнать», а не ноль.
 */
export async function vipGroupMemberCount(
  api: TelegramApi,
  groupId: string,
  budgetMs = MEMBER_COUNT_BUDGET_MS,
): Promise<number | null> {
  if (!groupId) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  const count = api
    .call<number>("getChatMemberCount", { chat_id: groupId })
    .then((r) => (r.ok && typeof r.result === "number" ? r.result : null))
    .catch(() => null);
  try {
    return await Promise.race([count, late]);
  } finally {
    clearTimeout(timer);
  }
}
