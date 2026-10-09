import type { TenantContext } from "@/core/tenant/resolve.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { hashPassword, verifyPassword } from "@/app/auth/password";
import { UserError } from "@/core/i18n/user-error";
import { patchTenantSettings } from "@/core/tenant/resolve.server";
import {
  adminLoginTaken,
  findAdminLogin,
  normalizeLogin,
  STAFF_LOGIN_RE,
  type AdminLogin,
  type StaffRole,
} from "@/core/auth/roles";

/** Вход под логином и команда магазина. */

/** Кто входит под логином: владелец или пользователь магазина (core/auth/roles). */
export async function resolveAdminLogin(username: string): Promise<AdminLogin | null> {
  return findAdminLogin(await tenantDirectory(true), username);
}

export function checkAdminPassword(login: AdminLogin, password: string): boolean {
  return verifyPassword(password, login.passwordHash);
}

/* ── команда магазина: пользователи с ролями в bots.settings.admin.users ── */

export type TeamMember = {
  username: string;
  name: string | null;
  role: StaffRole;
  createdAt: string | null;
};

export function listTeam(ctx: TenantContext): TeamMember[] {
  return (ctx.tenant.settings.admin?.users ?? []).map((u) => ({
    username: u.username,
    name: u.name ?? null,
    role: u.role,
    createdAt: u.created_at ?? null,
  }));
}

export async function saveTeamMember(
  ctx: TenantContext,
  input: { username: string; name?: string; role: StaffRole; password?: string },
): Promise<void> {
  const username = normalizeLogin(input.username);
  if (!STAFF_LOGIN_RE.test(username))
    throw new UserError(
      "err.admin.loginFormat",
      "Логин: латиница, цифры, точка, дефис и «_», от 3 до 40 символов.",
    );
  if (username === ctx.tenant.settings.admin?.username)
    throw new UserError("err.admin.loginIsOwner", "Это логин владельца магазина.");
  const users = [...(ctx.tenant.settings.admin?.users ?? [])];
  const existing = users.find((u) => u.username === username);
  if (adminLoginTaken(await tenantDirectory(true), username, { botId: ctx.tenant.id, username }))
    throw new UserError("err.admin.loginTaken", "Логин «{login}» уже занят.", { login: username });
  if (!existing && !input.password)
    throw new UserError("err.admin.passwordRequired", "Для нового пользователя нужен пароль.");
  if (input.password && input.password.length < 8)
    throw new UserError("err.admin.passwordShort", "Пароль — не короче 8 символов.");
  const next = {
    username,
    password_hash: input.password ? hashPassword(input.password) : existing!.password_hash,
    role: input.role,
    name: input.name?.trim() || undefined,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  const merged = existing
    ? users.map((u) => (u.username === username ? next : u))
    : [...users, next];
  if (merged.length > 20)
    throw new UserError("err.admin.teamLimit", "Не больше 20 пользователей у магазина.");
  await patchTenantSettings(ctx.tenant.id, { admin: { users: merged } });
}

export async function deleteTeamMember(ctx: TenantContext, username: string): Promise<void> {
  const u = normalizeLogin(username);
  const users = (ctx.tenant.settings.admin?.users ?? []).filter((x) => x.username !== u);
  await patchTenantSettings(ctx.tenant.id, { admin: { users } });
}
