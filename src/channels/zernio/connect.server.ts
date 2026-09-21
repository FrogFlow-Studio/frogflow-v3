import { env } from "@/config/env";
import type { Tenant, ZernioAccountSnapshot } from "@/core/tenant/types";
import { patchTenantSettings, requireTenant } from "@/core/tenant/resolve.server";
import {
  accountProfileId,
  connectUrl,
  createProfile,
  listAccounts,
  listProfiles,
  readWebhookSettings,
  upsertWebhook,
  zernioConfigured,
} from "./api.server";
import { isZernioPlatform, type ZernioPlatform } from "./platform";
import { describeWebhookFit, isOtherStoreWebhook } from "./webhook-fit";

/**
 * Подключение Instagram/WhatsApp клиентом из админки. У каждого клиента —
 * свой профиль Zernio (в v1 профиль задавался переменной деплоя); аккаунты
 * профиля синхронизируются в bots.settings.zernio.account_ids — по ним
 * вебхук находит арендатора. Ключ API и вебхук — одни на платформу.
 */
export async function ensureTenantProfile(tenant: Tenant): Promise<string> {
  const existing = tenant.settings.zernio?.profile_id;
  if (existing) return existing;
  const name = `${tenant.name} · ${tenant.id.slice(0, 8)}`;
  const found = (await listProfiles()).find((p) => p.name === name);
  const profile = found ?? (await createProfile(name, `FrogFlow: ${tenant.name}`));
  await patchTenantSettings(tenant.id, { zernio: { profile_id: profile._id } });
  return profile._id;
}

export async function connectLink(tenant: Tenant, platform: ZernioPlatform): Promise<string> {
  if (!zernioConfigured())
    throw new Error("Zernio не подключён на платформе — обратитесь к оператору.");
  const profileId = await ensureTenantProfile(tenant);
  const back = `${env().APP_URL.replace(/\/$/, "")}/admin/settings?zernio=connected`;
  return connectUrl(platform, profileId, back);
}

export type SyncResult = { accounts: ZernioAccountSnapshot[]; accountIds: string[] };

/** Аккаунты профиля → account_ids арендатора (ручные id оператора сохраняются). */
export async function syncAccounts(tenant: Tenant): Promise<SyncResult> {
  if (!zernioConfigured()) throw new Error("Zernio не подключён на платформе.");
  const profileId = tenant.settings.zernio?.profile_id;
  if (!profileId) return { accounts: [], accountIds: tenant.settings.zernio?.account_ids ?? [] };
  const accounts = (await listAccounts(profileId))
    .filter((a) => isZernioPlatform(a.platform))
    .filter((a) => (accountProfileId(a) ?? profileId) === profileId);
  const snapshot: ZernioAccountSnapshot[] = accounts.map((a) => ({
    id: a._id,
    platform: a.platform,
    username: a.username,
    name: a.name,
    expired: a.isExpired === true,
  }));
  const manual = tenant.settings.zernio?.account_ids ?? [];
  const accountIds = Array.from(new Set([...manual, ...snapshot.map((a) => a.id)]));
  await patchTenantSettings(tenant.id, {
    zernio: { account_ids: accountIds, accounts: snapshot, synced_at: new Date().toISOString() },
  });
  return { accounts: snapshot, accountIds };
}

export async function syncAccountsById(botId: string): Promise<SyncResult> {
  return syncAccounts(await requireTenant({ by: "id", value: botId }));
}

export type EnsureWebhookResult = {
  ok: boolean;
  action: "unchanged" | "set" | "skipped" | "error";
  url?: string;
  previousUrl?: string | null;
  error?: string;
};

/**
 * Вебхук платформы: одна запись на ключ Zernio. Чужой деплой (v1 клиента с
 * тем же ключом) не перетягиваем без `force` — клиенты переезжают по одному.
 */
export async function ensurePlatformWebhook(
  opts: { force?: boolean } = {},
): Promise<EnsureWebhookResult> {
  if (!zernioConfigured()) return { ok: true, action: "skipped", error: "ZERNIO_API_KEY не задан" };
  const url = `${env().APP_URL.replace(/\/$/, "")}/api/zernio/webhook`;
  let webhooks;
  try {
    webhooks = await readWebhookSettings();
  } catch (e) {
    return { ok: false, action: "error", url, error: e instanceof Error ? e.message : String(e) };
  }
  const { fit, current } = describeWebhookFit(webhooks, url);
  if (fit === "ok") return { ok: true, action: "unchanged", url, previousUrl: current?.url };
  if (!opts.force && isOtherStoreWebhook(current?.url, url))
    return {
      ok: true,
      action: "skipped",
      url: current?.url,
      previousUrl: current?.url,
      error: `вебхук слушает ${current?.url}`,
    };
  const r = await upsertWebhook(url);
  if (!r.ok)
    return { ok: false, action: "error", url, previousUrl: current?.url ?? null, error: r.error };
  return { ok: true, action: "set", url, previousUrl: current?.url ?? null };
}
