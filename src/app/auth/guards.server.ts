import { appSession } from "./session.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";

export class Unauthorized extends Error {
  constructor(public readonly role: "operator" | "admin") {
    super("Unauthorized");
  }
}

/** Первой строкой каждой серверной функции панели оператора. */
export async function requireOperator(): Promise<void> {
  const s = await appSession();
  if (s.data.operator !== true) throw new Unauthorized("operator");
}

/** Первой строкой каждой серверной функции админки: возвращает контекст арендатора из сессии. */
export async function requireAdmin(): Promise<TenantContext> {
  const s = await appSession();
  const botId = s.data.admin?.botId;
  if (!botId) throw new Unauthorized("admin");
  const tenant = await requireTenant({ by: "id", value: botId });
  if (tenant.archived) throw new Unauthorized("admin");
  return tenantContext(tenant);
}

export async function requireAdminModule(
  key: keyof TenantContext["tenant"]["modules"],
): Promise<TenantContext> {
  const ctx = await requireAdmin();
  if (!ctx.tenant.modules[key]) throw new Error(`Модуль «${key}» не подключён к вашему тарифу.`);
  return ctx;
}
