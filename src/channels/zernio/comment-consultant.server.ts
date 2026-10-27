/**
 * Ответ консультанта на комментарий в Instagram одним личным сообщением
 * (core/consultant/comment-reply). Instagram разрешает на комментарий один
 * private reply; дальше писать можно, только когда покупатель сам напишет в
 * Direct. Поэтому сообщение самодостаточное: цена из прайса или дежурное
 * приглашение. Под комментарием публично ничего не пишем.
 *
 * Один раз на покупателя под публикацией: отметку ставит вставка в
 * zernio_logs с уникальным event_id до вызова модели, шлёт только
 * выигравший; отправку, которая могла дойти, не повторяем.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import { commentLang } from "@/core/instagram/comment-rules";
import { serverFailure } from "@/lib/server-failure";
import {
  liveAutomationApi,
  zernioRuleCoversComment,
  type AutomationApi,
} from "./automations.server";
import type { CommentReceivedPayload } from "./automations.server";
import type { CommentConsultantResult } from "@/core/consultant/comment-reply.server";

export const COMMENT_CONSULTANT_EVENT = "comment.consultant_reply";

export type CommentConsultantDeps = {
  api?: Pick<AutomationApi, "privateReply" | "list">;
  /** Подмена консультанта в тестах (модель и бюджет — в core). */
  answer?: (
    ctx: TenantContext,
    p: Parameters<
      typeof import("@/core/consultant/comment-reply.server").consultantCommentAnswer
    >[1],
  ) => Promise<CommentConsultantResult>;
  /** Подмена проверки правил Zernio в тестах. */
  ruleCovers?: (p: {
    accountId: string;
    text: string;
    postId: string;
    caption?: string | null;
  }) => Promise<boolean>;
};

export async function replyToCommentByConsultant(
  ctx: TenantContext,
  payload: CommentReceivedPayload,
  deps: CommentConsultantDeps = {},
): Promise<{ note: string }> {
  if (!servedByV2(ctx.tenant)) return { note: "клиент не на v2" };
  if (!ctx.tenant.modules.instagram) return { note: "модуль «instagram» выключен" };
  const { commentReplyEnabled } = await import("@/core/consultant/comment-reply.server");
  if (!(await commentReplyEnabled(ctx)))
    return { note: "ответ консультанта на комментарии выключен" };
  const { consultantEnabled } = await import("@/core/consultant/engine.server");
  if (!(await consultantEnabled(ctx))) return { note: "консультант выключен" };

  const accountId = payload.account?.accountId || payload.account?.id || payload.account?._id;
  const commentId = payload.comment?.id?.trim();
  const text = payload.comment?.text?.trim() ?? "";
  const authorId = payload.comment?.author?.id?.trim() || null;
  const username = payload.comment?.author?.username?.trim() || null;
  // Private reply идёт по id публикации Instagram (как и догоняющие ответы).
  const postId = (payload.comment?.platformPostId || payload.post?.platformPostId || "").trim();
  if (!accountId || !commentId || !text || !postId || !(authorId || username))
    return { note: "нет accountId/commentId/текста/публикации/автора" };
  if (
    (authorId && authorId === payload.account?.id) ||
    (username &&
      payload.account?.username &&
      username.toLowerCase() === payload.account.username.toLowerCase())
  )
    return { note: "комментарий самого аккаунта" };

  const caption = payload.post?.content?.trim() || null;
  const permalink = payload.post?.permalink?.trim() || null;
  const covers =
    deps.ruleCovers ??
    ((p) =>
      zernioRuleCoversComment(
        ctx,
        p,
        (deps.api as AutomationApi | undefined) ?? liveAutomationApi,
      ));
  if (await covers({ accountId, text, postId, caption }))
    return { note: "на комментарий отвечает правило Zernio" };

  const who = authorId ?? `@${username!.toLowerCase()}`;
  const key = `consultant-comment:${postId}:${who}`;
  const { error: claimErr } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: key,
    event_type: COMMENT_CONSULTANT_EVENT,
    status: "pending",
    error_message: null,
    payload: { commentId, postId, username, authorId, comment: text.slice(0, 500) },
  });
  if (claimErr) {
    if (/duplicate|unique/i.test(claimErr.message))
      return { note: "покупателю под этой публикацией уже ответили" };
    throw serverFailure(`[zernio] отметка ответа на комментарий не записана: ${claimErr.message}`);
  }

  const locale = commentLang(text);
  // Менеджер ведёт этого покупателя (пауза консультанта) — без ИИ, дежурное приглашение.
  const { upsertCustomer, isBlocked } = await import("@/core/customers/customers");
  const customer = authorId
    ? await upsertCustomer(ctx, "instagram", authorId, { username, zernioAccountId: accountId })
    : null;
  if (customer && (await isBlocked(ctx, customer.telegramId))) {
    await settle(ctx, key, "skipped", "покупатель заблокирован", {});
    return { note: "покупатель заблокирован" };
  }
  const { isPaused } = await import("@/core/consultant/engine.server");
  const { COMMENT_NEUTRAL } = await import("@/core/consultant/comment-reply");
  let answer: CommentConsultantResult;
  if (customer && isPaused(customer)) {
    answer = {
      kind: "neutral",
      text: COMMENT_NEUTRAL[locale],
      why: "консультант на паузе",
      usd: 0,
      model: null,
      tools: [],
    };
  } else {
    const run =
      deps.answer ??
      (await import("@/core/consultant/comment-reply.server")).consultantCommentAnswer;
    answer = await run(ctx, { text, caption, postId, permalink, locale });
  }

  const api = deps.api ?? liveAutomationApi;
  const sent = await api.privateReply(postId, commentId, accountId, answer.text, []);
  const details = {
    kind: answer.kind,
    reply: answer.text,
    ...(answer.kind === "neutral" ? { why: answer.why } : {}),
    usd: answer.usd,
    model: answer.model,
    tools: answer.tools,
  };
  await settle(
    ctx,
    key,
    sent.ok ? "processed" : "failed",
    sent.ok ? null : (sent.error ?? "private reply не ушёл"),
    details,
  );
  if (!sent.ok) return { note: `ответ на комментарий не ушёл @${username ?? who}: ${sent.error}` };

  // В историю диалога: покупатель напишет в Direct — консультант видит, что уже ответил.
  if (customer) {
    const { commitTurn } = await import("@/core/consultant/burst");
    const { HISTORY_TURNS } = await import("@/core/consultant/engine.server");
    await commitTurn(ctx, customer, {
      turnId: null,
      items: [{ id: `comment:${commentId}`, text: `[комментарий под публикацией] ${text}` }],
      reply: answer.text,
      historyTurns: HISTORY_TURNS,
      patch: (cur) => ({ ...cur, last_reply_at: new Date().toISOString() }),
    }).catch((e: unknown) =>
      console.warn(`[zernio] ответ на комментарий ушёл, история не записана: ${String(e)}`),
    );
  }
  return {
    note: `консультант ответил на комментарий @${username ?? who} (${answer.kind === "price" ? "цена" : "приглашение"})`,
  };
}

async function settle(
  ctx: TenantContext,
  key: string,
  status: "processed" | "failed" | "skipped",
  error: string | null,
  details: Record<string, import("@/core/db-types").Json>,
) {
  const { data: row, error: readErr } = await ctx.db
    .from("zernio_logs")
    .select("payload")
    .eq("bot_id", ctx.tenant.id)
    .eq("event_id", key)
    .maybeSingle();
  if (readErr)
    console.warn(`[zernio] отметка ответа на комментарий не прочитана: ${readErr.message}`);
  const base =
    row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};
  const { error: doneErr } = await ctx.db
    .from("zernio_logs")
    .update({
      status,
      error_message: error?.slice(0, 500) ?? null,
      payload: { ...base, ...details },
    })
    .eq("bot_id", ctx.tenant.id)
    .eq("event_id", key);
  if (doneErr) console.warn(`[zernio] итог ответа на комментарий не записан: ${doneErr.message}`);
}
