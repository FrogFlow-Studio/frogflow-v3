import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { STAFF_ROLES } from "@/core/auth/roles";

/**
 * Админка продавца: команда магазина.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const adminOwner = async () => (await import("@/app/auth/guards.server")).requireAdminRole("owner");

/* ── команда ─────────────────────────────────────────────────────── */

export const teamFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await adminOwner();
  return (await import("./admin.server")).listTeam(ctx);
});

export const saveTeamMemberFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        username: z.string().min(3).max(40),
        name: z.string().max(80).optional(),
        role: z.enum(STAFF_ROLES),
        password: z.string().min(8).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("admin_roles", "owner");
    await (await import("./admin.server")).saveTeamMember(ctx, data);
    return { ok: true };
  });

export const deleteTeamMemberFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ username: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    await (await import("./admin.server")).deleteTeamMember(ctx, data.username);
    return { ok: true };
  });
