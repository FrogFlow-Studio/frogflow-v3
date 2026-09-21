import { appSession } from "./session.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";

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
  // Архив или клиент прежней платформы (см. servedByV2) — сессия недействительна.
  if (tenant.archived || !servedByV2(tenant)) throw new Unauthorized("admin");
  return tenantContext(tenant);
}

/** Страница, доступная при любом из модулей (например, рассылки Telegram или WhatsApp). */
export async function requireAdminAnyModule(
  ...keys: Array<keyof TenantContext["tenant"]["modules"]>
): Promise<TenantContext> {
  const ctx = await requireAdmin();
  if (!keys.some((k) => ctx.tenant.modules[k]))
    throw new Error(`Модуль «${keys[0]}» не подключён к вашему тарифу.`);
  return ctx;
}

export async function requireAdminModule(
  key: keyof TenantContext["tenant"]["modules"],
): Promise<TenantContext> {
  const ctx = await requireAdmin();
  if (!ctx.tenant.modules[key]) throw new Error(`Модуль «${key}» не подключён к вашему тарифу.`);
  return ctx;
}
