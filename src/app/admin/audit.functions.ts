import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Журнал действий команды магазина — только владельцу; `who` — действия одного человека. */
export const shopAuditFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ who: z.string().max(40).optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("admin");
    const { listShopActions } = await import("./audit.server");
    const { normalizeLogin } = await import("@/core/auth/roles");
    const rows = await listShopActions(
      ctx.tenant.id,
      200,
      data.who ? normalizeLogin(data.who) : undefined,
    );
    const users = (ctx.tenant.settings.admin?.users ?? []).map((u) => u.username);
    return {
      rows,
      people: [ctx.tenant.settings.admin?.username, ...users].filter(Boolean) as string[],
    };
  });
