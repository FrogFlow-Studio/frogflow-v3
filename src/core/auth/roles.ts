/**
 * Роли в админке магазина. Владелец — учётка из bots.settings.admin (её
 * задаёт оператор); остальных владелец заводит сам в bots.settings.admin.users.
 * Логин уникален на всей платформе: по нему находится и магазин, и роль.
 *
 *   owner   — всё, включая настройки, оплату, модули и команду;
 *   manager — заказы, товары, покупатели, чат, рассылки, скидки;
 *   viewer  — только смотреть (бухгалтер, аналитик): любое изменение отклоняется.
 */
import type { Tenant } from "@/core/tenant/types";

export const ADMIN_ROLES = ["owner", "manager", "viewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const RANK: Record<AdminRole, number> = { viewer: 0, manager: 1, owner: 2 };

export function isAdminRole(v: unknown): v is AdminRole {
  return typeof v === "string" && (ADMIN_ROLES as readonly string[]).includes(v);
}

/** Достаточно ли роли для действия, требующего `min`. */
export function roleAllows(role: AdminRole | undefined, min: AdminRole): boolean {
  return RANK[role ?? "owner"] >= RANK[min];
}

export const ROLE_TITLES: Record<AdminRole, string> = {
  owner: "владелец",
  manager: "менеджер",
  viewer: "просмотр",
};

export type AdminLogin = {
  tenant: Tenant;
  role: AdminRole;
  passwordHash: string | undefined;
  name: string | null;
};

export const normalizeLogin = (u: string) => u.trim().toLowerCase();

/** Кто входит под этим логином: владелец магазина или один из его пользователей. */
export function findAdminLogin(tenants: readonly Tenant[], username: string): AdminLogin | null {
  const u = normalizeLogin(username);
  if (!u) return null;
  for (const t of tenants) {
    if (t.archived) continue;
    const a = t.settings.admin;
    if (a?.username === u)
      return { tenant: t, role: "owner", passwordHash: a.password_hash, name: null };
    const user = a?.users?.find((x) => x.username === u);
    if (user)
      return {
        tenant: t,
        role: user.role,
        passwordHash: user.password_hash,
        name: user.name ?? null,
      };
  }
  return null;
}

/**
 * Кто сейчас этот логин в этом магазине — для каждой проверки сессии, а не
 * только при входе. Удалённый пользователь даёт null, пониженный — новую роль.
 */
export function loginInTenant(tenant: Tenant, username: string): AdminLogin | null {
  const found = findAdminLogin([tenant], username);
  return found && found.passwordHash ? found : null;
}

/** Логин занят: владельцем или пользователем любого магазина, кроме самой этой записи. */
export function adminLoginTaken(
  tenants: readonly Tenant[],
  username: string,
  except?: { botId: string; username?: string },
): boolean {
  const u = normalizeLogin(username);
  const isSelf = (t: Tenant) => Boolean(except && t.id === except.botId && except.username === u);
  for (const t of tenants) {
    const a = t.settings.admin;
    if (a?.username === u && !isSelf(t)) return true;
    if (a?.users?.some((x) => x.username === u) && !isSelf(t)) return true;
  }
  return false;
}
