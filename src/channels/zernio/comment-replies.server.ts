/**
 * Автоответы на комментарии без сообщения в Direct (v1 4cfbae3): правила
 * продавца — app_settings `comment_reply_rules`, отвеченные комментарии —
 * `comment_reply_answered` (последние 300, защита от повтора, не журнал).
 * Срабатывают на событие comment.received рядом с двухшаговой рассылкой;
 * чистая логика — core/instagram/comment-reply-rules.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import {
  pickReplyText,
  pickRuleForComment,
  type CommentReplyRule,
} from "@/core/instagram/comment-reply-rules";
import { liveAutomationApi, type AutomationApi } from "./automations.server";

export const RULES_KEY = "comment_reply_rules";
export const ANSWERED_KEY = "comment_reply_answered";
const ANSWERED_LIMIT = 300;

type Answered = { commentId: string; ruleId: string; at: string };

async function readList<T>(ctx: TenantContext, key: string): Promise<T[]> {
  try {
    const v = JSON.parse((await getSetting(ctx, key)) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export async function loadCommentReplyRules(ctx: TenantContext): Promise<CommentReplyRule[]> {
  return readList<CommentReplyRule>(ctx, RULES_KEY);
}

export type CommentReplyInput = {
  accountId?: string | null;
  commentId?: string | null;
  commentText?: string | null;
  platformPostId?: string | null;
  postId?: string | null;
  authorUsername?: string | null;
  accountUsername?: string | null;
};

export async function replyToCommentByRules(
  ctx: TenantContext,
  p: CommentReplyInput,
  api: Pick<AutomationApi, "publicReply"> = liveAutomationApi,
): Promise<{ status: "sent" | "no_rule" | "already" | "skipped" | "failed"; error?: string }> {
  const accountId = p.accountId?.trim();
  const commentId = p.commentId?.trim();
  const text = p.commentText?.trim() ?? "";
  if (!accountId || !commentId || !text) return { status: "skipped" };
  // На свои же комментарии магазин не отвечает.
  const author = p.authorUsername?.trim().toLowerCase();
  const own = p.accountUsername?.trim().toLowerCase();
  if (author && own && author === own) return { status: "skipped" };

  const rules = await loadCommentReplyRules(ctx);
  const rule = rules.length ? pickRuleForComment(rules, text, p.platformPostId) : null;
  if (!rule) return { status: "no_rule" };
  const answered = await readList<Answered>(ctx, ANSWERED_KEY);
  if (answered.some((a) => a.commentId === commentId)) return { status: "already" };
  const message = pickReplyText(rule, answered.filter((a) => a.ruleId === rule.id).length);
  const postId = (p.platformPostId || p.postId || "").trim();
  if (!message || !postId) return { status: "skipped" };
  const res = await api.publicReply(postId, commentId, accountId, message);
  if (!res.ok) return { status: "failed", error: res.error };
  // Отмечаем только после успешной отправки: сбой сети не съедает попытку.
  await setSetting(
    ctx,
    ANSWERED_KEY,
    JSON.stringify(
      [...answered, { commentId, ruleId: rule.id, at: new Date().toISOString() }].slice(
        -ANSWERED_LIMIT,
      ),
    ),
  ).catch((e) => console.warn("[comment-reply] ответ отправлен, но не отмечен", e));
  return { status: "sent" };
}
