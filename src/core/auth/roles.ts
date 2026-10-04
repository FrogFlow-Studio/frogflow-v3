/**
 * Роли в админке магазина. Владелец — учётка из bots.settings.admin (её
 * задаёт оператор); остальных владелец заводит сам в bots.settings.admin.users.
 * Логин уникален на всей платформе: по нему находится и магазин, и роль.
 *
 *   owner   — всё, включая настройки, оплату, модули и команду;
 *   manager — заказы, товары, покупатели, чат, рассылки, скидки;
 *   viewer  — только смотреть (аналитик): любое изменение отклоняется;
 *   accountant — бухгалтер: только заказы, оплаты, чеки, выручка, аналитика и
 *             выгрузка заказов без контактов покупателей; ничего не меняет.
 *             Сервер закрывает ему всё, что явно не открыто (guards.server).
 */
import type { Tenant } from "@/core/tenant/types";

export const ADMIN_ROLES = ["owner", "manager", "viewer", "accountant"] as const;
/** Роли, которые владелец выдаёт сотрудникам. */
export const STAFF_ROLES = ["manager", "viewer", "accountant"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Кто видит и выгружает контакты покупателей (телефон, почта: полный архив,
 * покупатели, заказы с именем и телефоном, карточка покупателя из диалога):
 * владелец или менеджер, а не «только просмотр». Каталог контактов не содержит.
 */
export const CONTACTS_MIN_ROLE = "manager" as const;

const RANK: Record<AdminRole, number> = { accountant: 0, viewer: 0, manager: 1, owner: 2 };

/** Достаточно ли роли для действия, требующего `min`. */
export function roleAllows(role: AdminRole | undefined, min: AdminRole): boolean {
  return RANK[role ?? "owner"] >= RANK[min];
}

export const ROLE_TITLES: Record<AdminRole, string> = {
  owner: "владелец",
  manager: "менеджер",
  viewer: "просмотр",
  accountant: "бухгалтер",
};

/** Может ли роль что-то менять (кнопки в интерфейсе; сервер проверяет сам). */
export function canEdit(role: AdminRole | undefined): boolean {
  return roleAllows(role, "manager");
}

export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === "string" && (STAFF_ROLES as readonly string[]).includes(v);
}

export type AdminLogin = {
  tenant: Tenant;
  role: AdminRole;
  passwordHash: string | undefined;
  name: string | null;
};

/** Логин сотрудника: латиница, цифры, «.», «-», «_», от 3 до 40 символов. */
export const STAFF_LOGIN_RE = /^[a-z0-9][a-z0-9_.-]{2,39}$/;

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
    // Пользователи команды входят, только пока оплачен модуль admin_roles;
    // логин при этом остаётся занятым (adminLoginTaken их по-прежнему видит).
    const user = t.modules.admin_roles ? a?.users?.find((x) => x.username === u) : undefined;
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
