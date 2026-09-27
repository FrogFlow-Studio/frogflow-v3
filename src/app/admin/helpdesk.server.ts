import type { Tenant } from "@/core/tenant/types";

export type TeamMember = { username: string; name: string | null };

/** Кому можно назначить обращение: владелец и сотрудники с правом изменений (не «просмотр»). */
export function helpdeskTeam(tenant: Pick<Tenant, "settings">): TeamMember[] {
  const admin = tenant.settings.admin;
  const out: TeamMember[] = [];
  if (admin?.username) out.push({ username: admin.username, name: null });
  for (const u of admin?.users ?? [])
    if (u.role !== "viewer" && u.username) out.push({ username: u.username, name: u.name ?? null });
  return out;
}
