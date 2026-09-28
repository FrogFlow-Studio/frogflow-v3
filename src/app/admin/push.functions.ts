import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Push-уведомления в админку как приложение (core/push): подписка этого браузера. */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

export const pushConfigFn = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const { vapidFromEnv } = await import("@/core/push/admin-push");
  return { publicKey: vapidFromEnv()?.publicKey ?? null };
});

const sub = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(40).max(200),
  auth: z.string().min(10).max(100),
});

export const savePushFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => sub.parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { adminActor } = await import("@/app/auth/guards.server");
    const { saveAdminPush } = await import("@/core/push/admin-push");
    return { ok: await saveAdminPush(ctx, data, await adminActor()) };
  });

export const removePushFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ endpoint: z.string().max(1000) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { removeAdminPush } = await import("@/core/push/admin-push");
    await removeAdminPush(ctx, data.endpoint);
    return { ok: true };
  });
