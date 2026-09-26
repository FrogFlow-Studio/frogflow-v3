import { createServerFn } from "@tanstack/react-start";

/** Журнал действий команды магазина — только владельцу. */
export const shopAuditFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("owner");
  const { listShopActions } = await import("./audit.server");
  return listShopActions(ctx.tenant.id);
});
