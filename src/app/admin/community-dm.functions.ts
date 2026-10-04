import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DM_LIMITS } from "@/core/community/dm";

/**
 * Личные сообщения авторов (core/community/dm). Без таблицы (миграция 19-3 не применена)
 * отвечают { soon: true }. Читает любой сотрудник с включённым сообществом, пишет владелец или
 * менеджер.
 */
const id = z.string().uuid();
const guardRead = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const guardWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");
const soonable = async () => (await import("@/core/community/not-ready")).orSoon;
const dm = () => import("@/core/community/dm.server");

export const communityAuthorsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await guardRead();
  return { authors: await (await dm()).listAuthors(ctx) };
});

export const communityInboxFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await guardRead();
  const orSoon = await soonable();
  return orSoon(async () => ({ conversations: await (await dm()).inbox(ctx) }));
});

export const communityDmThreadFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ withId: id, offset: z.number().int().min(0).max(100_000).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await guardRead();
    const orSoon = await soonable();
    return orSoon(async () => (await dm()).dmThread(ctx, data.withId, data.offset));
  });

export const communityDmPrefsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await guardRead();
  return (await dm()).dmPrefs(ctx);
});

export const communityUnreadFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await guardRead();
  const orSoon = await soonable();
  return orSoon(async () => ({ unread: await (await dm()).unreadCount(ctx) }));
});

export const sendCommunityDmFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ toId: id, body: z.string().max(DM_LIMITS.body * 3) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    const orSoon = await soonable();
    return orSoon(async () =>
      (await import("./community-dm.server")).sendCommunityDm(ctx, data.toId, data.body),
    );
  });

export const setCommunityDmOffFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ off: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    await (await dm()).setDmOff(ctx, data.off);
    return { ok: true };
  });

export const setCommunityDmBlockedFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId: id, blocked: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    await (await dm()).setDmBlocked(ctx, data.botId, data.blocked);
    return { ok: true };
  });
