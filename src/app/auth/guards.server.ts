import { appSession, credentialStamp } from "./session.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import { loginInTenant, roleAllows, type AdminRole } from "@/core/auth/roles";
import { UserError } from "@/core/i18n/user-error";

export class Unauthorized extends Error {
  constructor(public readonly role: "operator" | "admin") {
    super("Unauthorized");
  }
}

/**
 * Первой строкой каждой серверной функции панели оператора. Сессия
 * действует, пока учётка оператора та же, что при входе (operatorStamp).
 */
export async function requireOperator(): Promise<void> {
  const s = await appSession();
  if (s.data.operator !== true || !s.data.operatorStamp) throw new Unauthorized("operator");
  const { operatorStamp } = await import("@/app/operator/credentials.server");
  if (s.data.operatorStamp !== (await operatorStamp())) throw new Unauthorized("operator");
}

type CurrentAdmin = { ctx: TenantContext; role: AdminRole; username: string };

/**
 * Пользователь админки по cookie, сверенный с bots.settings.admin на каждом
 * запросе: удалённый из команды или сменивший пароль теряет доступ сразу
 * (с точностью до минутного кеша справочника), роль берётся текущая, а не
 * записанная в cookie при входе.
 */
async function currentAdmin(): Promise<CurrentAdmin> {
  const s = await appSession();
  const a = s.data.admin;
  if (!a?.botId || !a.username || !a.stamp) throw new Unauthorized("admin");
  const tenant = await requireTenant({ by: "id", value: a.botId });
  // Архив или клиент прежней платформы (см. servedByV2) — сессия недействительна.
  if (tenant.archived || !servedByV2(tenant)) throw new Unauthorized("admin");
  const login = loginInTenant(tenant, a.username);
  if (!login || a.stamp !== adminStamp(tenant.id, a.username, login.passwordHash))
    throw new Unauthorized("admin");
  return { ctx: tenantContext(tenant), role: login.role, username: a.username };
}

/** Отпечаток для cookie продавца — при входе и при смене своего пароля. */
export function adminStamp(botId: string, username: string, passwordHash: string | undefined) {
  return credentialStamp("admin", botId, username, passwordHash);
}

/** Первой строкой каждой серверной функции админки: возвращает контекст арендатора из сессии. */
export async function requireAdmin(): Promise<TenantContext> {
  return (await currentAdmin()).ctx;
}

/** Текущая роль пользователя админки — из настроек магазина, не из cookie. */
export async function adminRole(): Promise<AdminRole> {
  return (await currentAdmin()).role;
}

export async function adminActor(): Promise<string> {
  return `admin:${(await currentAdmin()).username}`;
}

/** Изменение, требующее роли не ниже `min` (core/auth/roles). */
export async function requireAdminRole(min: AdminRole): Promise<TenantContext> {
  const { ctx, role } = await currentAdmin();
  if (!roleAllows(role, min))
    throw min === "owner"
      ? new UserError("err.auth.ownerOnly", "Это может изменить только владелец магазина.")
      : new UserError("err.auth.viewOnly", "У вашей роли нет прав на изменения — только просмотр.");
  return ctx;
}

/** Страница, доступная при любом из модулей (например, рассылки Telegram или WhatsApp). */
export async function requireAdminAnyModule(
  ...keys: Array<keyof TenantContext["tenant"]["modules"]>
): Promise<TenantContext> {
  const ctx = await requireAdmin();
  if (!keys.some((k) => ctx.tenant.modules[k]))
    throw new UserError("err.auth.moduleOff", "Модуль «{module}» не подключён к вашему тарифу.", {
      module: keys[0]!,
    });
  return ctx;
}

export async function requireAdminModule(
  key: keyof TenantContext["tenant"]["modules"],
  min?: AdminRole,
): Promise<TenantContext> {
  const ctx = min ? await requireAdminRole(min) : await requireAdmin();
  if (!ctx.tenant.modules[key])
    throw new UserError("err.auth.moduleOff", "Модуль «{module}» не подключён к вашему тарифу.", {
      module: key,
    });
  return ctx;
}
