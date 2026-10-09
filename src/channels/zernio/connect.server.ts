import { env } from "@/config/env";
import type { Tenant, ZernioAccountSnapshot } from "@/core/tenant/types";
import {
  patchTenantSettings,
  patchZernioIfSyncedAt,
  tenantDirectory,
} from "@/core/tenant/resolve.server";
import {
  foreignZernioAccounts,
  zernioProfileOwner,
  zernioReconnects,
  type ZernioReconnect,
} from "@/core/tenant/zernio-accounts";
import { servedByV2 } from "@/core/tenant/directory";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import { ZernioApiError } from "./errors";
import {
  accountProfileId,
  connectUrl,
  createProfile,
  deleteAccount,
  listAccounts,
  listProfiles,
  readWebhookSettings,
  writeV2Webhook,
  zernioConfigured,
} from "./api.server";
import { isZernioPlatform, type ZernioPlatform } from "./platform";
import {
  deliveredProfiles,
  foreignWebhooks,
  planV2Webhook,
  v2ProfileIds,
  type V2WebhookPlan,
} from "./webhook-fit";

/**
 * Подключение Instagram/WhatsApp клиентом из админки. У каждого клиента —
 * свой профиль Zernio (в v1 профиль задавался переменной деплоя); аккаунты
 * профиля синхронизируются в bots.settings.zernio.account_ids — по ним
 * вебхук находит арендатора. Ключ API один на платформу, вебхук v2 — свой,
 * с фильтром по профилям клиентов на v2 (webhook-fit.ts).
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

/**
 * Записать клиенту профиль Zernio, который у него уже есть в v1
 * (ZERNIO_PROFILE_ID деплоя v1): Instagram не переподключается, id
 * аккаунта и автоматизации в Zernio остаются прежними. Профиль должен быть
 * виден ключу платформы (та же команда Zernio) и не числиться у другого
 * клиента. Затем — обычная сверка аккаунтов профиля.
 */
export async function adoptTenantProfile(tenant: Tenant, profileId: string): Promise<SyncResult> {
  if (!zernioConfigured()) throw new Error("Zernio не подключён на платформе.");
  const id = profileId.trim();
  const owner = zernioProfileOwner(await tenantDirectory(true), tenant.id, id);
  if (owner) throw new Error(`Профиль ${id} уже у клиента «${owner.name}».`);
  if (!(await listProfiles()).some((p) => p._id === id))
    throw new Error(
      `Ключ Zernio платформы не видит профиль ${id}: он в другой команде Zernio. ` +
        "Нужен ключ той же команды или новое подключение Instagram в профиль v2.",
    );
  await patchTenantSettings(tenant.id, { zernio: { profile_id: id } });
  return syncAccounts({
    ...tenant,
    settings: { ...tenant.settings, zernio: { ...tenant.settings.zernio, profile_id: id } },
  });
}

export async function connectLink(tenant: Tenant, platform: ZernioPlatform): Promise<string> {
  if (!zernioConfigured())
    throw new Error("Zernio не подключён на платформе — обратитесь к оператору.");
  const profileId = await ensureTenantProfile(tenant);
  const back = `${env().APP_URL.replace(/\/$/, "")}/admin/settings?zernio=connected`;
  return connectUrl(platform, profileId, back);
}

export type SyncConflict = { id: string; platform: string; username?: string; ownerName: string };
export type SyncResult = {
  accounts: ZernioAccountSnapshot[];
  accountIds: string[];
  /** Аккаунты профиля, уже записанные у другого клиента, — этому не отдаём. */
  conflicts: SyncConflict[];
};

/** Аккаунты профиля без чужих — что записать в settings.zernio. */
async function accountSync(tenant: Tenant, profileId: string) {
  const accounts = (await listAccounts(profileId))
    .filter((a) => isZernioPlatform(a.platform))
    .filter((a) => (accountProfileId(a) ?? profileId) === profileId);
  const directory = await tenantDirectory(true);
  const foreign = new Map(
    foreignZernioAccounts(
      directory,
      tenant.id,
      accounts.map((a) => a._id),
    ).map((f) => [f.id, f.owner]),
  );
  const snapshot: ZernioAccountSnapshot[] = accounts
    .filter((a) => !foreign.has(a._id))
    .map((a) => ({
      id: a._id,
      platform: a.platform,
      username: a.username,
      name: a.name,
      expired: a.isExpired === true,
    }));
  const conflicts: SyncConflict[] = accounts
    .filter((a) => foreign.has(a._id))
    .map((a) => ({
      id: a._id,
      platform: a.platform,
      username: a.username,
      ownerName: foreign.get(a._id)!.name,
    }));
  const manual = (tenant.settings.zernio?.account_ids ?? []).filter((id) => !foreign.has(id));
  const accountIds = Array.from(new Set([...manual, ...snapshot.map((a) => a.id)]));
  return { accounts: snapshot, accountIds, conflicts };
}

/**
 * Аккаунты профиля → account_ids арендатора (ручные id оператора сохраняются).
 * Аккаунт, который числится у другого клиента, в список не попадает: ключ
 * один на платформу, и двое владельцев значили бы события «ничьи».
 */
export async function syncAccounts(tenant: Tenant): Promise<SyncResult> {
  if (!zernioConfigured()) throw new Error("Zernio не подключён на платформе.");
  const profileId = tenant.settings.zernio?.profile_id;
  if (!profileId)
    return { accounts: [], accountIds: tenant.settings.zernio?.account_ids ?? [], conflicts: [] };
  const r = await accountSync(tenant, profileId);
  const patch = {
    account_ids: r.accountIds,
    accounts: r.accounts,
    synced_at: new Date().toISOString(),
  };
  const moved = zernioReconnects(tenant.settings.zernio?.accounts ?? [], r.accounts);
  if (!moved.length) {
    await patchTenantSettings(tenant.id, { zernio: patch });
    return r;
  }
  // «Один раз»: о переподключении пишет оператору только тот, чья условная
  // запись прошла; опередивший прогон (крон и кнопка вместе) уже написал сам.
  const prev = tenant.settings.zernio?.synced_at ?? null;
  if (await patchZernioIfSyncedAt(tenant.id, prev, patch)) await alertReconnects(tenant, moved);
  else await patchTenantSettings(tenant.id, { zernio: patch });
  return r;
}

/**
 * Оператору — о каждом переподключении (новый id той же страницы). Только
 * клиенты v2; сбой отправки не роняет сверку и не повторяется: сообщение
 * могло дойти, а тишину всё равно поймает проба входящих.
 */
async function alertReconnects(tenant: Tenant, moved: readonly ZernioReconnect[]): Promise<void> {
  if (!servedByV2(tenant)) return;
  try {
    const [{ sendOperatorAlert }, { reconnectAlertText }] = await Promise.all([
      import("@/app/operator/health-alerts.server"),
      import("@/app/operator/health-alerts"),
    ]);
    const base = env().APP_URL.replace(/\/$/, "");
    for (const r of moved) {
      const sent = await sendOperatorAlert(
        reconnectAlertText(r, { clientName: tenant.name, botId: tenant.id, base }),
      );
      if (!sent.ok && sent.reason === "failed")
        console.warn(`[zernio] переподключение ${tenant.id}: оператору не ушло (${sent.error})`);
    }
  } catch (e) {
    console.warn(`[zernio] переподключение ${tenant.id}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Сверка после переподключения — не чаще раза в это окно на магазин. */
export const RESYNC_WINDOW_MS = 5 * 60_000;

/**
 * Событие пришло с новым id аккаунта (магазин найден по профилю): дописать
 * аккаунты профиля, не дожидаясь крона. Вызывается на каждое такое событие,
 * поэтому не чаще раза в RESYNC_WINDOW_MS (по settings.zernio.synced_at) и
 * условной записью: из одновременных прогонов пишет один, остальные молчат.
 * Возвращает true, если записал.
 */
export async function resyncAfterReconnect(tenant: Tenant, now = new Date()): Promise<boolean> {
  const profileId = tenant.settings.zernio?.profile_id;
  if (!zernioConfigured() || !profileId) return false;
  const prev = tenant.settings.zernio?.synced_at ?? null;
  const last = prev ? Date.parse(prev) : NaN;
  if (Number.isFinite(last) && now.getTime() - last < RESYNC_WINDOW_MS) return false;
  const r = await accountSync(tenant, profileId);
  const won = await patchZernioIfSyncedAt(tenant.id, prev, {
    account_ids: r.accountIds,
    accounts: r.accounts,
    synced_at: now.toISOString(),
  });
  if (won) {
    const moved = zernioReconnects(tenant.settings.zernio?.accounts ?? [], r.accounts);
    if (moved.length) await alertReconnects(tenant, moved);
  }
  return won;
}

export type V2WebhookState = {
  ok: boolean;
  /** unchanged/none — в порядке; create/update/disable — нужно нажать кнопку оператора. */
  action: V2WebhookPlan["action"] | "skipped" | "error";
  url?: string;
  profiles?: number;
  /** Записи других деплоев (v1): только показываем, v2 их не трогает. */
  foreign?: { name?: string; url?: string }[];
  /** Профили, чьи сообщения запись v2 доставляет сейчас (страж каналов судит по ним). */
  delivered?: string[];
  error?: string;
};

async function planFor(): Promise<
  | { ok: false; state: V2WebhookState }
  | { ok: true; url: string; plan: V2WebhookPlan; state: V2WebhookState }
> {
  if (!zernioConfigured())
    return { ok: false, state: { ok: true, action: "skipped", error: "ZERNIO_API_KEY не задан" } };
  const url = `${env().APP_URL.replace(/\/$/, "")}/api/zernio/webhook`;
  let webhooks;
  try {
    webhooks = await readWebhookSettings();
  } catch (e) {
    return {
      ok: false,
      state: { ok: false, action: "error", url, error: e instanceof Error ? e.message : String(e) },
    };
  }
  const profiles = v2ProfileIds(await tenantDirectory(true));
  const plan = planV2Webhook(webhooks, url, profiles);
  const foreign = foreignWebhooks(webhooks, url).map((w) => ({ name: w.name, url: w.url }));
  return {
    ok: true,
    url,
    plan,
    state: {
      ok: plan.action === "unchanged" || plan.action === "none",
      action: plan.action,
      url,
      profiles: profiles.length,
      foreign,
      delivered: deliveredProfiles(webhooks, url),
    },
  };
}

/** Состояние записи v2 — только чтение (крон и панель оператора). */
export async function v2WebhookStatus(): Promise<V2WebhookState> {
  return (await planFor()).state;
}

/**
 * Привязать вебхук v2 к профилям клиентов на v2 — только по кнопке
 * оператора (при переезде клиента), никогда крон или выкладка.
 */
export async function syncV2Webhook(): Promise<V2WebhookState> {
  const p = await planFor();
  if (!p.ok) return p.state;
  const r = await writeV2Webhook(p.plan);
  if (!r.ok) return { ...p.state, ok: false, action: "error", error: r.error };
  return { ...p.state, ok: true };
}

export type DisconnectResult = {
  /** Аккаунт отключён и в Zernio; false — только отвязан у нас (id записан оператором вручную). */
  inZernio: boolean;
};

/**
 * Отключить аккаунт Instagram/WhatsApp от магазина. Аккаунт из снимка
 * профиля клиента отключается и в Zernio: иначе сверка вернула бы его
 * обратно, а вебхук продолжал бы присылать события. Id, записанный
 * оператором вручную и не лежащий в профиле клиента, только отвязывается у
 * нас: он может быть чужим профилем, в Zernio его не трогаем. Сбой Zernio
 * (кроме 404 «уже отключён») — ошибка, у нас ничего не меняется. История
 * диалогов, заказы и покупатели остаются.
 */
export async function disconnectAccount(
  tenant: Tenant,
  accountId: string,
): Promise<DisconnectResult> {
  if (!servedByV2(tenant)) throw serverFailure("Магазин обслуживает прежняя платформа");
  const z = tenant.settings.zernio;
  const id = accountId.trim();
  const inSnapshot = (z?.accounts ?? []).some((a) => a.id === id);
  const known = inSnapshot || (z?.account_ids ?? []).includes(id);
  if (!known)
    throw new UserError(
      "err.admin.accountUnknown",
      "Этого аккаунта нет в списке подключённых — обновите страницу.",
    );
  if (inSnapshot) {
    if (!zernioConfigured()) throw serverFailure("Zernio не подключён на платформе");
    try {
      await deleteAccount(id);
    } catch (e) {
      // 404 — уже отключён (повтор, или отключили в Zernio сами): у нас остаётся убрать запись.
      if (!(e instanceof ZernioApiError && e.failure.status === 404))
        throw serverFailure(
          `Zernio не отключил аккаунт: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
  }
  // Список перечитываем: пока шёл вызов Zernio, сверка могла дописать другие аккаунты.
  const fresh = (await tenantDirectory(true)).find((t) => t.id === tenant.id)?.settings.zernio;
  await patchTenantSettings(tenant.id, {
    zernio: {
      account_ids: (fresh?.account_ids ?? []).filter((x) => x !== id),
      accounts: (fresh?.accounts ?? []).filter((a) => a.id !== id),
    },
  });
  return { inZernio: inSnapshot };
}
