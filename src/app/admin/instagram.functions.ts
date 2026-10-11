import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";
import type { AutomationButton } from "@/core/instagram/comment-rules";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { buttonSchema, postTitleSchema } from "./instagram-input";

/**
 * Раздел «Instagram»: правила Comment-to-DM через Zernio. Каждая функция
 * начинается с проверки модуля `instagram` — пункт меню лишь UX.
 */
const ig = async () => (await import("@/app/auth/guards.server")).requireAdminModule("instagram");
/** Изменения — с роли менеджера (core/auth/roles). */
const igWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminModule("instagram", "manager");
const accountId = z.string().min(1).max(100);

/**
 * Отказ Zernio при чтении правил и публикаций — понятной причиной, а не
 * пустым списком: «правил нет, видео нет» при чужом профиле Zernio путало
 * продавца (Educational Bot, 01.10).
 */
async function zernioReadError(e: unknown): Promise<UserError> {
  const { zernioFailureOf } = await import("@/channels/zernio/errors");
  const status = zernioFailureOf(e).status;
  console.error(`[instagram] Zernio: ${String(e)}`);
  return status !== null && [401, 403, 404].includes(status)
    ? new UserError(
        "err.admin.igZernioDenied",
        "Zernio не даёт доступа к профилю или аккаунту Instagram этого магазина, поэтому правила и публикации не видны. Напишите оператору платформы: нужно заново привязать профиль Zernio.",
      )
    : new UserError(
        "err.admin.igZernioUnavailable",
        "Zernio сейчас не отвечает — правила и публикации не загрузились. Обновите страницу через пару минут.",
      );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Названия товаров кнопок «Купить» — форме правила, чтобы предупредить, если
 * товар не упомянут в подписи поста. Подсказка, а не запрет: при сбое чтения
 * страница открывается без неё (сбой в журнале), правила остаются видны.
 */
async function buyProductNames(
  ctx: TenantContext,
  buttons: AutomationButton[],
): Promise<Record<string, string>> {
  const { buyButtonProductIds } = await import("@/core/instagram/comment-rules");
  const ids = buyButtonProductIds(buttons).filter((id) => UUID_RE.test(id));
  if (!ids.length) return {};
  const { productsByIds } = await import("@/core/catalog/picker");
  try {
    const found = await productsByIds(ctx, ids);
    return Object.fromEntries(found.map((p) => [p.id, p.name]));
  } catch (e) {
    console.error(`[instagram] названия товаров правил не прочитаны: ${String(e)}`);
    return {};
  }
}

export const instagramFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await ig();
  const a = await import("@/channels/zernio/automations.server");
  const { zernioConfigured } = await import("@/channels/zernio/api.server");
  const accounts = a.instagramAccounts(ctx);
  const configured = zernioConfigured();
  let automationsError: { key: string; message: string } | null = null;
  const [automations, fallbackSends] = await Promise.all([
    configured && accounts.length
      ? a.listAutomations(ctx).catch(async (e) => {
          const err = await zernioReadError(e);
          automationsError = { key: err.key, message: err.message };
          return [];
        })
      : Promise.resolve([]),
    a.listFallbackSends(ctx, 30),
  ]);
  const productNames = await buyProductNames(
    ctx,
    automations.flatMap((x) => x.buttons ?? []),
  );
  return {
    configured,
    accounts,
    automationsError: automationsError as { key: string; message: string } | null,
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
      commentReplyVariations: x.commentReplyVariations ?? [],
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
    productNames,
    telegramUsername: ctx.tenant.settings.telegram?.username ?? null,
  };
});

export const instagramPostsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await ig();
    const { listPosts } = await import("@/channels/zernio/automations.server");
    try {
      return { posts: await listPosts(ctx, data.accountId) };
    } catch (e) {
      throw await zernioReadError(e);
    }
  });

/**
 * Публикации всех Instagram-аккаунтов магазина — для тегов товаров
 * консультанта: продавец выбирает пост или рилс картинкой, а не копирует
 * ссылку (как вкладка «Сторис» в v1). Новые сверху.
 */
export const storyPostsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await ig();
  const { instagramAccounts, listPosts } = await import("@/channels/zernio/automations.server");
  try {
    const lists = await Promise.all(instagramAccounts(ctx).map((a) => listPosts(ctx, a.id)));
    const posts = lists
      .flat()
      .filter((p) => p.permalink)
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    return { posts };
  } catch (e) {
    throw await zernioReadError(e);
  }
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
        postTitle: postTitleSchema,
        keywords: z.array(z.string().max(100)).max(50).default([]),
        replyToAll: z.boolean().default(false),
        matchMode: z.enum(["exact", "contains"]).default("contains"),
        dmMessage: z.string().max(1000),
        buttons: z.array(buttonSchema).max(3).default([]),
        commentReply: z.string().max(1000).default(""),
        // Ещё варианты публичного ответа: Zernio чередует их с основным.
        commentReplyVariations: z.array(z.string().max(1000)).max(4).default([]),
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
