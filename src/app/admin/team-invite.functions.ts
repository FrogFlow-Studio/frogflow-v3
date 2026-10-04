import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { STAFF_ROLES } from "@/core/auth/roles";

const guards = () => import("@/app/auth/guards.server");

/** Ожидающие приглашения команды — владельцу. */
export const staffInvitesFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await guards()).requireAdminModule("admin_roles", "owner");
  return (await import("./team-invite.server")).listInvites(ctx);
});

/** Новая ссылка-приглашение; ссылка в ответе — единственный раз, когда её видно. */
export const createStaffInviteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ role: z.enum(STAFF_ROLES), name: z.string().max(80).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const g = await guards();
    const ctx = await g.requireAdminModule("admin_roles", "owner");
    const who = await g.adminIdentity();
    return (await import("./team-invite.server")).createInvite(ctx, who?.username ?? "", data);
  });

export const revokeStaffInviteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("admin_roles", "owner");
    await (await import("./team-invite.server")).revokeInvite(ctx, data.id);
    return { ok: true };
  });

/** Страница ссылки (без сессии): магазин и роль, если ссылка ещё действует. */
export const staffInviteInfoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ b: z.string().uuid(), t: z.string().min(10).max(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    const info = await (await import("./team-invite.server")).inviteInfo(data.b, data.t);
    return info ? { ok: true as const, ...info } : { ok: false as const };
  });

/** Принять приглашение (без сессии): секрет в ссылке — единственное, что открывает запись. */
export const acceptStaffInviteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        b: z.string().uuid(),
        t: z.string().min(10).max(100),
        username: z.string().min(3).max(40),
        name: z.string().max(80).optional(),
        password: z.string().min(8).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { b, t, ...input } = data;
    const ok = await (await import("./team-invite.server")).acceptInvite(b, t, input);
    return { ok };
  });
