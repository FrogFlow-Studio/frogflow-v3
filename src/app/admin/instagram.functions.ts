import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/**
 * Раздел «Instagram»: правила Comment-to-DM через Zernio. Каждая функция
 * начинается с проверки модуля `instagram` — пункт меню лишь UX.
 */
const ig = async () => (await import("@/app/auth/guards.server")).requireAdminModule("instagram");
/** Изменения — с роли менеджера (core/auth/roles). */
const igWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminModule("instagram", "manager");
const accountId = z.string().min(1).max(100);

const buttonSchema = z.object({
  type: z.enum(["url", "postback"]),
  title: z.string().min(1).max(40),
  url: z.string().url().max(500).optional(),
  payload: z.string().max(100).optional(),
});

export const instagramFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await ig();
  const a = await import("@/channels/zernio/automations.server");
  const { zernioConfigured } = await import("@/channels/zernio/api.server");
  const accounts = a.instagramAccounts(ctx);
  const configured = zernioConfigured();
  const [automations, fallbackSends] = await Promise.all([
    configured && accounts.length ? a.listAutomations(ctx).catch(() => []) : Promise.resolve([]),
    a.listFallbackSends(ctx, 30),
  ]);
  return {
    configured,
    accounts,
    automations: automations.map((x) => ({
      id: a.automationId(x),
      name: x.name,
      accountId: x.accountId,
      trigger: x.trigger ?? "comment",
      platformPostId: x.platformPostId ?? null,
      postId: x.postId ?? null,
      postTitle: x.postTitle ?? "",
      keywords: x.keywords ?? [],
      matchMode: x.matchMode ?? "contains",
      dmMessage: x.dmMessage ?? "",
      buttons: x.buttons ?? [],
      commentReply: x.commentReply ?? "",
      isActive: x.isActive !== false,
      twoStepDm: Boolean(x.twoStepDm),
      secondDmMessage: x.secondDmMessage ?? "",
      unresolvedPrompt: x.unresolvedPrompt ?? "",
      replyPrompt: x.replyPrompt ?? null,
      stats: {
        triggered: x.stats?.triggered ?? 0,
        dmsSent: x.stats?.dmsSent ?? 0,
        dmsFailed: x.stats?.dmsFailed ?? 0,
      },
    })),
    fallbackSends,
    telegramUsername: ctx.tenant.settings.telegram?.username ?? null,
  };
});

export const instagramPostsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await ig();
    const { listPosts } = await import("@/channels/zernio/automations.server");
    return { posts: await listPosts(ctx, data.accountId) };
  });

export const syncInstagramPostFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accountId, url: z.string().url().max(500) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await igWrite();
    const { syncPostByUrl } = await import("@/channels/zernio/automations.server");
    const r = await syncPostByUrl(ctx, data.accountId, data.url);
    if (!r.post)
      throw new UserError(
        "err.admin.igPostNotFound",
        "Zernio не нашёл публикацию по ссылке — проверьте ссылку и аккаунт.",
      );
    return r.post;
  });

export const saveAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().max(100).optional(),
        original: z
          .object({
            platformPostId: z.string().nullable().optional(),
            postId: z.string().nullable().optional(),
            trigger: z.string().optional(),
          })
          .optional(),
        accountId,
        name: z.string().min(1).max(120),
        trigger: z.enum(["comment", "story_reply"]).default("comment"),
        platformPostId: z.string().max(100).nullable().optional(),
        postId: z.string().max(100).nullable().optional(),
        postTitle: z.string().max(500).optional(),
        keywords: z.array(z.string().max(100)).max(50).default([]),
        replyToAll: z.boolean().default(false),
        matchMode: z.enum(["exact", "contains"]).default("contains"),
        dmMessage: z.string().max(1000),
        buttons: z.array(buttonSchema).max(3).default([]),
        commentReply: z.string().max(1000).default(""),
        twoStepDm: z.boolean().default(false),
        secondDmMessage: z.string().max(1000).default(""),
        unresolvedPrompt: z.string().max(500).default(""),
        replyPrompt: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await igWrite();
    const { saveAutomation } = await import("@/channels/zernio/automations.server");
    const r = await saveAutomation(ctx, data);
    if (!r.ok) throw new Error(r.error);
    return { id: r.id };
  });

export const deleteAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await igWrite();
    const { deleteAutomation } = await import("@/channels/zernio/automations.server");
    return { ok: await deleteAutomation(ctx, data.id) };
  });

export const toggleAutomationFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string().min(1).max(100), isActive: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await igWrite();
    const { toggleAutomation } = await import("@/channels/zernio/automations.server");
    return { ok: await toggleAutomation(ctx, data.id, data.isActive) };
  });

export const automationLogsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ id: z.string().min(1).max(100), onlyFailed: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await ig();
    const { automationLogs } = await import("@/channels/zernio/automations.server");
    const logs = await automationLogs(ctx, data.id, { limit: 100, onlyFailed: data.onlyFailed });
    return {
      logs: logs.map((l) => ({
        commentId: String(l.commentId ?? ""),
        username: String(l.username ?? l.commenterUsername ?? ""),
        commentText: String(l.commentText ?? l.comment ?? ""),
        status: String(l.status ?? ""),
        error: String(l.error ?? l.errorMessage ?? ""),
        commentReplyStatus: String(l.commentReplyStatus ?? ""),
        createdAt: String(l.createdAt ?? l.timestamp ?? ""),
      })),
    };
  });

export const postCommentsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId, postId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await ig();
    const { listPostComments, automationId } = await import("@/channels/zernio/automations.server");
    const r = await listPostComments(ctx, data.postId, data.accountId);
    return {
      automation: r.automation
        ? {
            id: automationId(r.automation),
            // Догоняющая рассылка шлёт первое сообщение целиком, с призывом ответить.
            dmMessage: r.automation.firstMessage ?? r.automation.dmMessage,
            buttons: r.automation.buttons ?? [],
            commentReply: r.automation.commentReply ?? "",
            twoStepDm: Boolean(r.automation.twoStepDm),
            secondDmMessage: r.automation.secondDmMessage ?? "",
          }
        : null,
      comments: r.comments.map((c) => ({
        id: c.id ?? "",
        text: c.message ?? "",
        username: c.from?.username ?? "",
        createdTime: c.createdTime ?? "",
        replyStatus: c.replyStatus,
        blockReason: c.blockReason,
      })),
    };
  });

const catchupBase = {
  accountId,
  postId: z.string().min(1).max(100),
  commentIds: z.array(z.string().min(1).max(100)).min(1).max(25),
  message: z.string().min(1).max(1000),
};

export const catchupPrivateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        ...catchupBase,
        buttons: z.array(buttonSchema).max(3).optional(),
        twoStepDm: z.boolean().optional(),
        secondDmMessage: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await igWrite();
    const { sendCatchupPrivateReplies } = await import("@/channels/zernio/automations.server");
    return { results: await sendCatchupPrivateReplies(ctx, data) };
  });

export const catchupPublicFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object(catchupBase).parse(d))
  .handler(async ({ data }) => {
    const ctx = await igWrite();
    const { sendCatchupCommentReplies } = await import("@/channels/zernio/automations.server");
    return { results: await sendCatchupCommentReplies(ctx, data) };
  });
