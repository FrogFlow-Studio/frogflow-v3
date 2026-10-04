import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import type { Locale } from "@/core/i18n/locale";
import { isBlocked, syntheticTelegramId, userKey } from "@/core/customers/customers";
import { commentMatchesAutomation } from "@/core/instagram/comment-rules";
import { isAccepting, listGiveaways, type Giveaway } from "@/core/giveaways/giveaway";
import { entryEventId, recordEntry } from "@/core/giveaways/entry";
import { liveAutomationApi, type AutomationApi } from "./automations.server";

/**
 * Участие в розыгрыше комментарием в Instagram (К3). Событие comment.received:
 * комментарий под постом розыгрыша со словом из условий записывает участника
 * (один на аккаунт Instagram) и отвечает ему в Direct. Участник пишется
 * условной вставкой до отправки, ответ шлёт только выигравший запись, поэтому
 * повтор вебхука и второй комментарий того же человека второго ответа не дают.
 * Ответ, который мог дойти (любой сбой Zernio), не повторяем.
 */
export type GiveawayCommentPayload = {
  account?: { accountId?: string; id?: string; _id?: string; username?: string };
  post?: { platformPostId?: string; id?: string };
  comment?: {
    id?: string;
    text?: string;
    postId?: string;
    platformPostId?: string;
    author?: { id?: string; username?: string };
  };
};

const DEFAULT_REPLY: Record<Locale, (title: string, prize: string) => string> = {
  ru: (t, p) => `🎉 Вы участвуете в розыгрыше «${t}»! Приз: ${p}. Итоги — после окончания приёма.`,
  kk: (t, p) =>
    `🎉 Сіз «${t}» ұтыс ойынына қатысып жатырсыз! Сыйлық: ${p}. Қорытынды — қабылдау біткен соң.`,
  en: (t, p) => `🎉 You are in the “${t}” giveaway! Prize: ${p}. Results after entries close.`,
  uz: (t, p) =>
    `🎉 Siz «${t}» sovrin o‘yinida qatnashyapsiz! Sovg‘a: ${p}. Natijalar — qabul tugagach.`,
};

export function giveawayReplyText(g: Giveaway, locale: Locale): string {
  return g.igReply || DEFAULT_REPLY[locale](g.title, g.prize);
}

export type GiveawayCommentResult = { note: string; entered: number };

export async function handleGiveawayComment(
  ctx: TenantContext,
  payload: GiveawayCommentPayload,
  api: AutomationApi = liveAutomationApi,
  now = new Date(),
): Promise<GiveawayCommentResult> {
  const accountId = payload.account?.accountId || payload.account?.id || payload.account?._id;
  const author = payload.comment?.author;
  const username = author?.username;
  const commentId = payload.comment?.id;
  const who = author?.id || (username ? username.toLowerCase() : "");
  if (!accountId || !who || !commentId)
    return { note: "розыгрыш: нет аккаунта или автора", entered: 0 };
  if (
    (author?.id && author.id === payload.account?.id) ||
    (payload.account?.username &&
      username?.toLowerCase() === payload.account.username.toLowerCase())
  )
    return { note: "розыгрыш: комментарий самого аккаунта", entered: 0 };
  const postId =
    payload.comment?.platformPostId ||
    payload.post?.platformPostId ||
    payload.comment?.postId ||
    payload.post?.id ||
    "";
  if (!postId) return { note: "розыгрыш: нет поста", entered: 0 };
  const text = payload.comment?.text?.trim().toLowerCase() ?? "";

  const matching = (await listGiveaways(ctx)).filter(
    (g) =>
      g.channel !== "telegram" &&
      g.igAccountId === accountId &&
      g.igPostId.trim() === postId.trim() &&
      isAccepting(g, now) &&
      commentMatchesAutomation(text, g.igKeyword ? [g.igKeyword] : undefined, "contains"),
  );
  if (matching.length === 0) return { note: "розыгрыш: подходящих нет", entered: 0 };

  const key = userKey("instagram", who);
  const telegramId = syntheticTelegramId(key);
  if (await isBlocked(ctx, telegramId))
    return { note: "розыгрыш: покупатель заблокирован", entered: 0 };

  const locale = ctx.tenant.settings.default_locale ?? "ru";
  let entered = 0;
  for (const g of matching) {
    const won = await recordEntry(
      ctx,
      g,
      {
        userKey: key,
        telegramId,
        channel: "instagram",
        extra: { username: username ?? null, comment_id: commentId, account_id: accountId },
      },
      now,
    );
    if (!won) continue;
    entered++;
    const r = await api.privateReply(
      postId,
      commentId,
      accountId,
      giveawayReplyText(g, locale),
      [],
    );
    await ctx.db
      .from("zernio_logs")
      .update({
        payload: {
          giveaway_id: g.id,
          user_key: key,
          telegram_id: telegramId,
          channel: "instagram",
          at: now.toISOString(),
          username: username ?? null,
          comment_id: commentId,
          account_id: accountId,
          dm: r.ok ? "sent" : "failed",
          ...(r.ok ? {} : { dm_error: (r.error ?? "").slice(0, 300) }),
        } as Json,
      })
      .eq("event_id", entryEventId(g.id, key));
  }
  return { note: `розыгрыш: участников записано ${entered}`, entered };
}
