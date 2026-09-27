import { appSession, credentialStamp } from "./session.server";
import { isSessionId, sessionFresh } from "./session-id";
import { isSessionRevoked } from "./revocation.server";

/** Номер входа есть, срок не вышел, при выходе не отозван. Cookie без номера (до отзыва) — нет. */
async function sessionAlive(sid: unknown, iat: unknown): Promise<boolean> {
  if (!isSessionId(sid) || !sessionFresh(iat)) return false;
  return !(await isSessionRevoked(sid));
}
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import { loginInTenant, roleAllows, type AdminRole } from "@/core/auth/roles";
import { UserError } from "@/core/i18n/user-error";
import { canSwitchShop, groupShops } from "@/core/tenant/shop-group";
import type { Tenant } from "@/core/tenant/types";

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
  if (!(await sessionAlive(s.data.operatorSid, s.data.operatorIat)))
    throw new Unauthorized("operator");
  const { operatorStamp } = await import("@/app/operator/credentials.server");
  if (s.data.operatorStamp !== (await operatorStamp())) throw new Unauthorized("operator");
}

type CurrentAdmin = {
  ctx: TenantContext;
  role: AdminRole;
  username: string;
  /** Магазин, где заведён логин; ctx — выбранный магазин группы (или он же). */
  home: Tenant;
};

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
  if (!(await sessionAlive(a.sid, a.iat))) throw new Unauthorized("admin");
  const tenant = await requireTenant({ by: "id", value: a.botId });
  // Архив или клиент прежней платформы (см. servedByV2) — сессия недействительна.
  if (tenant.archived || !servedByV2(tenant)) throw new Unauthorized("admin");
  const login = loginInTenant(tenant, a.username);
  if (!login || a.stamp !== adminStamp(tenant.id, a.username, login.passwordHash))
    throw new Unauthorized("admin");
  const active = await activeShop(tenant, login.role, a.activeBotId);
  return { ctx: tenantContext(active), role: login.role, username: a.username, home: tenant };
}

/**
 * Модуль «Несколько ботов»: выбранный владельцем магазин его группы. Право
 * сверяется на каждом запросе — оператор отвязал магазин или выключил
 * модуль, и работа сразу возвращается в свой магазин, без чужих данных.
 * Сотрудники (не владелец) остаются в магазине, где заведены.
 */
async function activeShop(home: Tenant, role: AdminRole, activeBotId?: string): Promise<Tenant> {
  if (!activeBotId || activeBotId === home.id || role !== "owner") return home;
  const target = await requireTenant({ by: "id", value: activeBotId }).catch(() => null);
  return target && canSwitchShop(home, target) ? target : home;
}

/** Магазины группы, доступные текущему продавцу: свой первым; без модуля — только свой. */
export async function adminShops(): Promise<{ current: string; shops: Tenant[] }> {
  const { ctx, role, home } = await currentAdmin();
  if (role !== "owner") return { current: ctx.tenant.id, shops: [home] };
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  return { current: ctx.tenant.id, shops: groupShops(await tenantDirectory(), home) };
}

/** Перейти в другой магазин группы. Только владелец и только в свою группу. */
export async function switchAdminShop(botId: string): Promise<void> {
  const { role, home } = await currentAdmin();
  const s = await appSession();
  if (botId === home.id) {
    await s.update({ admin: { ...s.data.admin!, activeBotId: undefined } });
    return;
  }
  const target =
    role === "owner" ? await requireTenant({ by: "id", value: botId }).catch(() => null) : null;
  if (!target || !canSwitchShop(home, target))
    throw new UserError("err.auth.shopSwitch", "Этот магазин не связан с вашим.");
  await s.update({ admin: { ...s.data.admin!, activeBotId: target.id } });
}

/**
 * Кто из магазина сейчас действует, без исключения: null — нет действующей
 * сессии продавца. Для журнала действий (src/start.ts), не для доступа.
 */
export async function adminIdentity(): Promise<{ botId: string; username: string } | null> {
  try {
    const a = await currentAdmin();
    return { botId: a.ctx.tenant.id, username: a.username };
  } catch {
    return null;
  }
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
