import { createServerFn } from "@tanstack/react-start";

/** Бухгалтеру открыты: лента без отзывов и имён покупателей, отметка «прочитано» — своя. */
const finance = async () => (await import("@/app/auth/guards.server")).requireAdminFinance();
const actor = async () => (await import("@/app/auth/guards.server")).adminActor();

/** Лента уведомлений магазина за 30 дней и сколько в ней нового для этого входа. */
export const notificationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { ctx, accountant } = await finance();
  const { listNotifications } = await import("@/core/notifications/feed");
  const readAt = ctx.tenant.settings.notify_read?.[await actor()];
  const feed = await listNotifications(ctx, {
    role: accountant ? "accountant" : undefined,
    readAt,
  });
  return { ...feed, timezone: ctx.timezone };
});

/** «Отметить всё прочитанным»: время в `settings.notify_read` по логину, только вперёд. */
export const markNotificationsReadFn = createServerFn({ method: "POST" }).handler(async () => {
  const { ctx } = await finance();
  const who = await actor();
  const prev = ctx.tenant.settings.notify_read?.[who];
  const now = new Date();
  const next = prev && Date.parse(prev) > now.getTime() ? prev : now.toISOString();
  const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
  await patchTenantSettings(ctx.tenant.id, { notify_read: { [who]: next } });
  return { readAt: next };
});
