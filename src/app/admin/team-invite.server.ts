import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "@/config/env";
import { UserError } from "@/core/i18n/user-error";
import { adminLoginTaken, normalizeLogin, STAFF_LOGIN_RE, type StaffRole } from "@/core/auth/roles";
import { INVITE_TTL_MS, MAX_PENDING_INVITES, liveInvites } from "@/core/auth/staff-invite";
import { servedByV2 } from "@/core/tenant/directory";
import {
  resolveTenant,
  tenantDirectory,
  updateAdminSettings,
  type TenantContext,
} from "@/core/tenant/resolve.server";
import type { AdminInvite, Tenant } from "@/core/tenant/types";
import { hashPassword } from "@/app/auth/password";
import { recordShopAction } from "./audit.server";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const rawInvites = (admin: Record<string, unknown>): AdminInvite[] =>
  Array.isArray(admin.invites) ? (admin.invites as AdminInvite[]) : [];

export type PendingInvite = {
  id: string;
  role: StaffRole;
  name: string | null;
  createdAt: string;
  expiresAt: string;
};

export function listInvites(ctx: TenantContext, now = Date.now()): PendingInvite[] {
  return liveInvites(ctx.tenant.settings.admin?.invites, now).map((i) => ({
    id: i.id,
    role: i.role,
    name: i.name ?? null,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
  }));
}

/**
 * Новое приглашение: ссылка показывается один раз (в настройках остаётся
 * только хеш секрета), действует 7 дней и принимается один раз.
 */
export async function createInvite(
  ctx: TenantContext,
  by: string,
  input: { role: StaffRole; name?: string },
  now = Date.now(),
): Promise<{ link: string; expiresAt: string }> {
  const secret = randomBytes(24).toString("base64url");
  const invite: AdminInvite = {
    id: randomUUID(),
    hash: sha256(secret),
    role: input.role,
    name: input.name?.trim() || undefined,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + INVITE_TTL_MS).toISOString(),
    by,
  };
  const ok = await updateAdminSettings(ctx.tenant.id, (admin) => {
    const live = liveInvites(rawInvites(admin), now);
    if (live.length >= MAX_PENDING_INVITES) return null;
    return { ...admin, invites: [...live, invite] };
  });
  if (!ok)
    throw new UserError(
      "err.admin.inviteLimit",
      "Не больше 20 приглашений одновременно — отзовите лишние.",
    );
  return {
    link: `${env().APP_URL}/admin/invite?b=${ctx.tenant.id}&t=${secret}`,
    expiresAt: invite.expires_at,
  };
}

export async function revokeInvite(ctx: TenantContext, id: string): Promise<void> {
  await updateAdminSettings(ctx.tenant.id, (admin) => {
    const invites = rawInvites(admin);
    if (!invites.some((i) => i.id === id)) return null;
    return { ...admin, invites: invites.filter((i) => i.id !== id) };
  });
}

/** Магазин, который сейчас может принимать сотрудников; иначе null. */
async function inviteShop(botId: string): Promise<Tenant | null> {
  const t = await resolveTenant({ by: "id", value: botId });
  // Сотрудники входят, только пока оплачен модуль admin_roles (core/auth/roles).
  if (!t || t.archived || !servedByV2(t) || !t.modules.admin_roles) return null;
  return t;
}

/** Что увидит приглашённый на странице ссылки. Просрочено, использовано, отозвано — одинаково null. */
export async function inviteInfo(
  botId: string,
  secret: string,
  now = Date.now(),
): Promise<{ shop: string; role: StaffRole; name: string | null } | null> {
  const t = await inviteShop(botId);
  if (!t) return null;
  const hash = sha256(secret);
  const i = liveInvites(t.settings.admin?.invites, now).find((x) => x.hash === hash);
  return i ? { shop: t.name, role: i.role, name: i.name ?? null } : null;
}

/**
 * Принять приглашение: создаётся пользователь с ролью из приглашения, само
 * приглашение удаляется той же записью. Запись условна по settings.rev, поэтому
 * из двух одновременных принятий проходит одно. false — ссылка не действует.
 */
export async function acceptInvite(
  botId: string,
  secret: string,
  input: { username: string; password: string; name?: string },
  now = Date.now(),
): Promise<boolean> {
  const t = await inviteShop(botId);
  if (!t) return false;
  const hash = sha256(secret);
  // Секрет ссылки проверяется раньше всего: без действующего приглашения ответ один — «ссылка не
  // действует», а не «логин занят» или «логин неверного вида», иначе по чужому адресу можно было бы
  // выяснять, какие логины заняты у других магазинов. Читаем свежий справочник: он нужен и ниже.
  const directory = await tenantDirectory(true);
  const current = directory.find((x) => x.id === botId);
  if (!liveInvites(current?.settings.admin?.invites, now).some((i) => i.hash === hash))
    return false;
  const username = normalizeLogin(input.username);
  if (!STAFF_LOGIN_RE.test(username))
    throw new UserError(
      "err.admin.loginFormat",
      "Логин: латиница, цифры, точка, дефис и «_», от 3 до 40 символов.",
    );
  if (input.password.length < 8)
    throw new UserError("err.admin.passwordShort", "Пароль — не короче 8 символов.");
  // Логин проверяем до записи, чтобы занятый логин не сжигал приглашение.
  if (adminLoginTaken(directory, username))
    throw new UserError("err.admin.loginTaken", "Логин «{login}» уже занят.", { login: username });
  let role: StaffRole | null = null;
  let full = false;
  const written = await updateAdminSettings(botId, (admin) => {
    const invites = rawInvites(admin);
    const invite = liveInvites(invites, now).find((i) => i.hash === hash);
    if (!invite) return null;
    const users = Array.isArray(admin.users) ? (admin.users as Array<Record<string, unknown>>) : [];
    if (users.length >= 20) {
      full = true;
      return null;
    }
    // Тот же логин мог занять другой принявший между проверкой и записью.
    if (users.some((u) => u.username === username)) return null;
    role = invite.role;
    return {
      ...admin,
      users: [
        ...users,
        {
          username,
          password_hash: hashPassword(input.password),
          role: invite.role,
          name: input.name?.trim() || invite.name || undefined,
          created_at: new Date(now).toISOString(),
        },
      ],
      invites: invites.filter((i) => i.id !== invite.id),
    };
  });
  if (full) throw new UserError("err.admin.teamLimit", "Не больше 20 пользователей у магазина.");
  if (!written || !role) return false;
  await recordShopAction({ botId, username }, "inviteAccepted", { role });
  return true;
}
