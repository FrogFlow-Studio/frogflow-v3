import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Рабочее место консультанта без продаж (app/admin/workspace.server): «Обзор»
 * — любому сотруднику (задачи с именами покупателей — не ниже менеджера),
 * журнал ответов по диалогу — с текстами покупателей, не ниже менеджера.
 */
const server = () => import("./workspace.server");

export const consultantOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  const guards = await import("@/app/auth/guards.server");
  const ctx = await guards.requireAdmin();
  const { CONTACTS_MIN_ROLE, roleAllows } = await import("@/core/auth/roles");
  const contacts = roleAllows(await guards.adminRole(), CONTACTS_MIN_ROLE);
  return (await server()).consultantOverview(ctx, { contacts });
});

export const consultantJournalFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        userKey: z.string().min(1).max(200),
        offset: z.number().int().min(0).max(100_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const guards = await import("@/app/auth/guards.server");
    const { CONTACTS_MIN_ROLE } = await import("@/core/auth/roles");
    const ctx = await guards.requireAdminRole(CONTACTS_MIN_ROLE);
    return (await server()).consultantJournal(ctx, data.userKey, data.offset ?? 0);
  });
