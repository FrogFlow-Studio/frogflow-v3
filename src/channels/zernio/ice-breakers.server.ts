import type { Tenant } from "@/core/tenant/types";
import { patchTenantSettings, requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import { directBotSettingKeys, directBotSettingsFrom } from "@/core/instagram/direct-bot-settings";
import { ICE_BREAKERS_KEY, iceBreakersFor, parseIceBreakers } from "@/core/instagram/ice-breakers";
import { serviceDb } from "@/core/db/client.server";
import { serverFailure } from "@/lib/server-failure";
import {
  deleteInstagramIceBreakers,
  setInstagramIceBreakers,
  zernioConfigured,
  type IceBreaker,
} from "./api.server";
import { sha256Hex } from "@/lib/hash";

/**
 * Быстрые вопросы Instagram (core/instagram/ice-breakers) в аккаунтах
 * клиента. Как меню команд Telegram (#248): ставим только клиенту v2,
 * отпечаток набора — в settings.zernio.ice_breakers_v, чтобы крон не звал
 * Zernio каждый прогон; при откате на v1 снимаем. Пустой отпечаток — мы
 * ничего не ставили: подсказки, которые продавец завёл в Instagram сам, не
 * трогаем.
 */
export type IceBreakerApi = {
  set: (accountId: string, items: IceBreaker[]) => Promise<void>;
  clear: (accountId: string) => Promise<void>;
};

const liveApi: IceBreakerApi = { set: setInstagramIceBreakers, clear: deleteInstagramIceBreakers };

export type IceBreakersState = {
  ok: boolean;
  action: "unchanged" | "set" | "cleared" | "skipped";
  error?: string;
};

/** Аккаунты Instagram клиента из снимка; истёкшие — только для снятия (их тоже пробуем). */
function instagramAccounts(tenant: Tenant, withExpired = false): string[] {
  const ids = new Set(tenant.settings.zernio?.account_ids ?? []);
  return (tenant.settings.zernio?.accounts ?? [])
    .filter((a) => a.platform === "instagram" && ids.has(a.id) && (withExpired || !a.expired))
    .map((a) => a.id)
    .sort();
}

/**
 * Настройки подсказок и автоответчика одним запросом. Сбой чтения — ошибка,
 * а не «выключено»: иначе сбой базы снял бы подсказки у всех аккаунтов.
 */
async function readConfig(tenant: Tenant) {
  const ctx = tenantContext(tenant);
  const keys = [ICE_BREAKERS_KEY, ...directBotSettingKeys("instagram")];
  const { data, error } = await ctx.db.from("app_settings").select("key, value").in("key", keys);
  if (error) throw serverFailure(`быстрые вопросы: настройки не прочитаны (${error.message})`);
  const values: Record<string, string> = {};
  for (const r of data ?? []) if (r.value != null) values[r.key] = r.value;
  return {
    cfg: parseIceBreakers(values[ICE_BREAKERS_KEY]),
    bot: directBotSettingsFrom(values, "instagram"),
  };
}

/**
 * Клиент всё ещё на v2 — по свежему чтению bots.settings, а не по снимку:
 * крон, начавший прогон до отката на v1, не должен вернуть подсказки.
 */
async function stillServedByV2(botId: string): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("bots")
    .select("settings")
    .eq("id", botId)
    .maybeSingle();
  if (error) throw serverFailure(`быстрые вопросы: клиент не прочитан (${error.message})`);
  const settings = (data?.settings ?? {}) as { served_by?: unknown };
  return settings.served_by === "v2";
}

export function iceBreakersVersion(accounts: string[], items: IceBreaker[]): string {
  if (!accounts.length || !items.length) return "";
  return sha256Hex(JSON.stringify([accounts, items]), 16);
}

/** Привести подсказки в Instagram к настройке продавца. Сбой — отпечаток не пишем, крон повторит. */
export async function ensureIceBreakers(
  tenant: Tenant,
  api: IceBreakerApi = liveApi,
): Promise<IceBreakersState> {
  if (!servedByV2(tenant) || tenant.archived || !zernioConfigured())
    return { ok: true, action: "skipped" };
  const { cfg, bot } = await readConfig(tenant);
  const items = iceBreakersFor(cfg, bot, tenant.modules);
  const accounts = instagramAccounts(tenant);
  const want = iceBreakersVersion(accounts, items);
  const have = tenant.settings.zernio?.ice_breakers_v ?? "";
  if (want === have) return { ok: true, action: "unchanged" };
  if (!(await stillServedByV2(tenant.id))) return { ok: true, action: "skipped" };
  const failed: string[] = [];
  for (const id of want ? accounts : instagramAccounts(tenant, true)) {
    try {
      await (want ? api.set(id, items) : api.clear(id));
    } catch (e) {
      failed.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed.length)
    return { ok: false, action: want ? "set" : "cleared", error: failed.join("; ") };
  // Откат мог случиться, пока шли вызовы Zernio: отпечаток v2 клиенту v1 не
  // пишем, а только что поставленное снимаем — откат его уже не увидит.
  if (!(await stillServedByV2(tenant.id))) {
    if (want) for (const id of accounts) await api.clear(id).catch(() => undefined);
    return { ok: true, action: "skipped" };
  }
  await patchTenantSettings(tenant.id, { zernio: { ice_breakers_v: want } });
  return { ok: true, action: want ? "set" : "cleared" };
}

/**
 * Откат клиента на v1: v1 постбэки `IB:…` не понимает, подсказки снимаем.
 * Вызывается до того, как клиент перестал быть «нашим», поэтому served_by
 * не проверяет — только наш отпечаток.
 */
export async function releaseIceBreakersToV1(
  tenant: Tenant,
  api: IceBreakerApi = liveApi,
): Promise<void> {
  if (!tenant.settings.zernio?.ice_breakers_v || !zernioConfigured()) return;
  const failed: string[] = [];
  for (const id of instagramAccounts(tenant, true)) {
    try {
      await api.clear(id);
    } catch (e) {
      failed.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Не снялось — отпечаток оставляем: оператор видит ошибку и повторяет откат.
  if (failed.length) throw new Error(`быстрые вопросы не сняты: ${failed.join("; ")}`);
  await patchTenantSettings(tenant.id, { zernio: { ice_breakers_v: "" } });
}

/** После записи настроек (продавец сохранил, аккаунты сверены): свежий снимок арендатора. Не бросает. */
export async function refreshIceBreakers(botId: string): Promise<IceBreakersState> {
  try {
    return await ensureIceBreakers(await requireTenant({ by: "id", value: botId }));
  } catch (e) {
    return { ok: false, action: "skipped", error: e instanceof Error ? e.message : String(e) };
  }
}
