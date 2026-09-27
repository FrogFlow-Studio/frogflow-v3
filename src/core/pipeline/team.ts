import type { Tenant } from "@/core/tenant/types";

/**
 * Кого можно назначить ответственным за заявку: владелец и, пока подключён
 * модуль admin_roles, пользователи «Команды». Логины — как при входе.
 */
export function teamLogins(tenant: Pick<Tenant, "settings" | "modules">): string[] {
  const a = tenant.settings.admin;
  const out = a?.username ? [a.username] : [];
  if (tenant.modules.admin_roles)
    for (const u of a?.users ?? [])
      if (u.username && !out.includes(u.username)) out.push(u.username);
  return out;
}
