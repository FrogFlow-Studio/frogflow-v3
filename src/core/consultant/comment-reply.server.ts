import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import { getSettings } from "@/core/settings/settings";
import { commentNote, commentReplyOn, COMMENT_REPLY_KEY, pickCommentAnswer } from "./comment-reply";
import type { CommentAnswer } from "./comment-reply";
import type { ConsultantResult } from "./engine.server";

/** Включён ли ответ консультанта на комментарии у клиента (выбор продавца или BOVI по умолчанию). */
export async function commentReplyEnabled(ctx: TenantContext): Promise<boolean> {
  const raw = (await getSettings(ctx, [COMMENT_REPLY_KEY]))[COMMENT_REPLY_KEY];
  return commentReplyOn(raw, ctx.tenant.id);
}

export type CommentConsultantResult = CommentAnswer & {
  usd: number;
  model: string | null;
  tools: string[];
};

/**
 * Текст единственного личного ответа на комментарий. Консультант (бюджет,
 * ИИ-баланс, лимит частоты, сверка цен с прайсом — всё в runConsultant)
 * отвечает без истории: публикация передаётся как сторис — по отметке
 * продавца (id публикации) или по подписи.
 */
export async function consultantCommentAnswer(
  ctx: TenantContext,
  p: { text: string; caption: string | null; postId: string; locale: Locale },
  run?: (
    text: string,
    story: { storyId: string; caption: string | null },
  ) => Promise<ConsultantResult | null>,
): Promise<CommentConsultantResult> {
  const call =
    run ??
    (async (text: string, story: { storyId: string; caption: string | null }) => {
      const { runConsultant } = await import("./engine.server");
      return runConsultant(ctx, null, text, {
        platform: "instagram",
        story: { storyId: story.storyId, mediaUrl: null, caption: story.caption },
      });
    });
  let r: ConsultantResult | null = null;
  try {
    r = await call(`${commentNote()}\n\n${p.text}`, { storyId: p.postId, caption: p.caption });
  } catch (e) {
    console.error(`[consultant:${ctx.tenant.id}] ответ на комментарий не составлен`, e);
  }
  const answer = pickCommentAnswer(
    r
      ? {
          reply: r.reply,
          handoff: Boolean(r.handoff),
          attachments: r.attachments?.length ?? 0,
          failed: Boolean(r.skipped),
        }
      : null,
    p.locale,
  );
  return { ...answer, usd: r?.usage.usd ?? 0, model: r?.model ?? null, tools: r?.tools ?? [] };
}
