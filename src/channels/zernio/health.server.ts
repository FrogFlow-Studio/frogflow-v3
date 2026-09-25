import { zernioConfigured } from "./api.server";
import { syncAccounts } from "./connect.server";
import { handleAccountDisconnected } from "./handle-account";
import { tenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { diffZernioSnapshots } from "@/core/tenant/zernio-accounts";

/**
 * Здоровье аккаунтов Instagram/WhatsApp — часть крона health. Раз в
 * четверть часа профиль каждого клиента v2 сверяется с Zernio: новый
 * аккаунт становится виден без кнопки «обновить» в админке, отвалившийся
 * помечается в снимке и продавец получает предупреждение в Telegram (с
 * тем же откатом, что у события account.disconnected — не чаще раза в
 * шесть часов по аккаунту). Клиенты без профиля пропускаются: им нечего
 * сверять.
 */
export type ZernioHealthResult = {
  tenants: number;
  synced: number;
  added: number;
  expired: number;
  conflicts: number;
  errors: Record<string, string>;
};

export async function syncZernioAccountsFor(
  tenants: readonly Tenant[],
): Promise<ZernioHealthResult> {
  const r: ZernioHealthResult = {
    tenants: 0,
    synced: 0,
    added: 0,
    expired: 0,
    conflicts: 0,
    errors: {},
  };
  if (!zernioConfigured()) return r;
  for (const t of tenants) {
    if (!t.settings.zernio?.profile_id) continue;
    r.tenants++;
    try {
      const before = t.settings.zernio.accounts ?? [];
      const { accounts, conflicts } = await syncAccounts(t);
      const diff = diffZernioSnapshots(before, accounts);
      r.synced++;
      r.added += diff.added.length;
      r.conflicts += conflicts.length;
      for (const a of diff.expired) {
        r.expired++;
        const ctx = tenantContext({
          ...t,
          settings: { ...t.settings, zernio: { ...t.settings.zernio, accounts } },
        });
        await handleAccountDisconnected(ctx, {
          account: { accountId: a.id, username: a.username, name: a.name, platform: a.platform },
        });
      }
    } catch (e) {
      r.errors[t.id] = e instanceof Error ? e.message : String(e);
    }
  }
  return r;
}
