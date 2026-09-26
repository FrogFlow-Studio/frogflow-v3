import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Раздел «Публикации»: посты, Reels и сторис в Instagram клиента через
 * Zernio. Как и правила Comment-to-DM — под модулем `instagram`; публикует
 * менеджер и выше (core/auth/roles).
 */
const ig = async () => (await import("@/app/auth/guards.server")).requireAdminModule("instagram");
const igWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminModule("instagram", "manager");

export const postsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await ig();
  const { zernioConfigured } = await import("@/channels/zernio/api.server");
  const { instagramAccounts } = await import("@/channels/zernio/automations.server");
  const { listOwnPosts } = await import("@/channels/zernio/posts.server");
  const configured = zernioConfigured();
  return {
    configured,
    accounts: instagramAccounts(ctx),
    timezone: ctx.timezone,
    posts: configured ? await listOwnPosts(ctx) : [],
  };
});

export const publishPostFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        kind: z.enum(["feed", "reel", "story"]),
        accountIds: z.array(z.string().min(1).max(100)).min(1).max(10),
        text: z.string().max(2200).default(""),
        media: z.array(z.string().min(1).max(300)).min(1).max(10),
        scheduledFor: z.string().datetime().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await igWrite();
    const { publishPost } = await import("@/channels/zernio/posts.server");
    return publishPost(ctx, { ...data, timezone: ctx.timezone });
  });

export const cancelPostFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ postId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await igWrite();
    const { cancelScheduledPost } = await import("@/channels/zernio/posts.server");
    if (!(await cancelScheduledPost(ctx, data.postId)))
      throw new Error("Публикация не найдена среди ваших.");
    return { ok: true };
  });
