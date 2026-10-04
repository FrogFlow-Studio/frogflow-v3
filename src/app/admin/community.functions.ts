import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { COMMUNITY_LIMITS } from "@/core/community/profile";

/** Профиль автора в сообществе (core/community): читают все сотрудники, меняет владелец. */
export const communityProfileFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  return (await import("@/core/community/settings.server")).communityView(ctx);
});

export const saveCommunityProfileFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        name: z.string().max(COMMUNITY_LIMITS.name),
        niche: z.string().max(COMMUNITY_LIMITS.niche),
        city: z.string().max(COMMUNITY_LIMITS.city),
        about: z.string().max(COMMUNITY_LIMITS.about),
        links: z.array(z.string().max(COMMUNITY_LIMITS.link)).max(COMMUNITY_LIMITS.links),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("owner");
    return (await import("@/core/community/settings.server")).saveCommunityProfile(ctx, data);
  });

/* ── темы, ответы, жалобы (С2) ─────────────────────────────────────────
 * Без таблиц (миграция 19-2 ещё не применена) отвечают { soon: true }. Читает любой сотрудник
 * с включённым сообществом, пишет владелец или менеджер. */
const section = z.enum(["questions", "experience", "offers"]);
const id = z.string().uuid();
const guardRead = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const guardWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");
const soonable = async () => (await import("@/core/community/not-ready")).orSoon;

export const communityThreadsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        section,
        topic: z.enum(["packaging", "photo", "delivery", "contractors"]).nullable().optional(),
        search: z.string().max(200).optional(),
        offset: z.number().int().min(0).max(100_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await guardRead();
    const orSoon = await soonable();
    return orSoon(async () =>
      (await import("@/core/community/threads.server")).listThreads(ctx, data),
    );
  });

export const communityThreadFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ id, offset: z.number().int().min(0).max(100_000).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await guardRead();
    const orSoon = await soonable();
    return orSoon(async () =>
      (await import("@/core/community/threads.server")).getThread(ctx, data.id, data.offset),
    );
  });

export const createCommunityThreadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        section,
        topic: z.enum(["packaging", "photo", "delivery", "contractors"]).nullable().optional(),
        title: z.string().max(400),
        body: z.string().max(10_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    const orSoon = await soonable();
    return orSoon(async () =>
      (await import("@/core/community/threads.server")).createThread(ctx, data),
    );
  });

export const createCommunityPostFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ threadId: id, body: z.string().max(10_000) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    const orSoon = await soonable();
    return orSoon(async () =>
      (await import("@/core/community/threads.server")).createPost(ctx, data.threadId, data.body),
    );
  });

export const reportCommunityFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        threadId: id,
        postId: id.nullable().optional(),
        reason: z.string().max(600).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    const orSoon = await soonable();
    return orSoon(async () =>
      (await import("@/core/community/threads.server")).reportContent(ctx, data),
    );
  });

/* ── «Спросить совет» со страницы админки (С4) ─────────────────────── */
export const communityAdviceReadyFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await guardRead();
  return { ready: await (await import("@/core/community/threads.server")).communityReady(ctx) };
});

export const askCommunityAdviceFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        page: z.enum(["warehouse", "discounts"]),
        question: z.string().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    const t = await (await import("@/app/admin/locale.server")).adminTFor(ctx);
    const orSoon = await soonable();
    return orSoon(async () =>
      (await import("@/core/community/threads.server")).askAdvice(ctx, {
        page: data.page,
        pageTitle: t(`community.ask.page.${data.page}`),
        question: data.question,
      }),
    );
  });
