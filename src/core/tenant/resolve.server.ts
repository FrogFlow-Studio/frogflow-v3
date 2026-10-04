import { serviceDb, tenantDb, type Db } from "@/core/db/client.server";
import { env } from "@/config/env";
import { decryptSecret, isEncryptedSecret } from "@/core/secrets/vault";
import { availableModules } from "@/core/modules/registry";
import {
  findTenant,
  findZernioTenant,
  tenantFromRow,
  TENANT_COLUMNS,
  type TenantRow,
} from "./directory";
import type { ChannelGuardEntry, Tenant, TenantLookup } from "./types";
import type { WizardEntry } from "./wizard-entry";
import { serverFailure } from "@/lib/server-failure";

/**
 * Справочник арендаторов — все неархивные строки `bots`, в памяти на минуту.
 *
 * Serverless держит несколько инстансов, поэтому это ускорение, а не
 * гарантия мгновенности: «включил тумблер в панели — заработало в течение
 * минуты». Для корректности достаточно TTL, для нетерпеливых есть
 * invalidateTenantDirectory().
 */
const TTL_MS = 60_000;
let directory: { at: number; tenants: Tenant[] } | null = null;
let inflight: Promise<Tenant[]> | null = null;

async function loadDirectory(): Promise<Tenant[]> {
  const { data, error } = await serviceDb()
    .from("bots")
    .select(TENANT_COLUMNS)
    .is("archived_at", null);
  if (error) throw serverFailure(`Не удалось прочитать справочник арендаторов: ${error.message}`);
  return (data as TenantRow[]).map(tenantFromRow);
}

export async function tenantDirectory(fresh = false): Promise<Tenant[]> {
  if (!fresh && directory && Date.now() - directory.at < TTL_MS) return directory.tenants;
  if (!inflight) {
    inflight = loadDirectory()
      .then((tenants) => {
        directory = { at: Date.now(), tenants };
        return tenants;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function invalidateTenantDirectory(): void {
  directory = null;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Номер версии bots.settings (`settings.rev`). Его растит каждая запись
 * settings в v2 (patchTenantSettings, сверка Zernio, API оператора), а
 * условная запись сверяет его вместо всего settings: весь jsonb в фильтре
 * строки запроса у магазина с командой не влезает в предел URL.
 */
export function settingsRev(raw: Record<string, unknown>): number | null {
  return typeof raw.rev === "number" && Number.isInteger(raw.rev) ? raw.rev : null;
}
export const nextSettingsRev = (raw: Record<string, unknown>) => (settingsRev(raw) ?? 0) + 1;

/**
 * Дописать ключи в bots.settings, не трогая остальные. Пишем поверх сырого
 * jsonb из базы, а не поверх разобранного Tenant.settings: там лежат и ключи
 * v1 (политика неоплаты on_overdue/grace_days), которых v2 не знает и
 * которые терять нельзя.
 */
export async function patchTenantSettings(
  botId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = serviceDb();
  const { data, error: readError } = await db
    .from("bots")
    .select("settings")
    .eq("id", botId)
    .maybeSingle();
  // Запись поверх непрочитанного снимка стёрла бы остальные ключи клиента.
  if (readError) throw serverFailure(`bots.settings: не прочитаны (${readError.message})`);
  if (!data) throw serverFailure(`bots.settings: магазин ${botId} не найден`);
  const raw = asObject(data.settings);
  const next: Record<string, unknown> = { ...raw };
  for (const [k, v] of Object.entries(patch)) {
    const prev = next[k];
    next[k] =
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      prev &&
      typeof prev === "object" &&
      !Array.isArray(prev)
        ? { ...(prev as object), ...(v as object) }
        : v;
  }
  next.rev = nextSettingsRev(raw);
  const { error } = await db
    .from("bots")
    .update({ settings: next as never })
    .eq("id", botId);
  if (error) throw serverFailure(`bots.settings: ${error.message}`);
  invalidateTenantDirectory();
}

/**
 * Дописать в bots.settings.zernio, только если с прочтения его никто не
 * сверял (settings.zernio.synced_at тот же): другой прогон, успевший раньше,
 * выигрывает, этот ничего не пишет (false). Пишется весь settings, поэтому
 * запись условна и по номеру версии settings.rev: если продавец или
 * оператор успел сохранить другой ключ, перечитываем и пробуем снова. Не удалось
 * прочитать — не пишем вовсе: запись поверх пустого снимка стёрла бы
 * served_by, slug и profile_id.
 */
export async function patchZernioIfSyncedAt(
  botId: string,
  prevSyncedAt: string | null,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const db = serviceDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.from("bots").select("settings").eq("id", botId).maybeSingle();
    if (error)
      throw serverFailure(`bots.settings: сверка не прочитала настройки (${error.message})`);
    if (!data) throw serverFailure(`bots.settings: магазин ${botId} не найден`);
    const raw = asObject(data.settings);
    const zernio = asObject(raw.zernio);
    const synced = typeof zernio.synced_at === "string" ? zernio.synced_at : null;
    if (synced !== prevSyncedAt) return false;
    const rev = settingsRev(raw);
    const next = { ...raw, zernio: { ...zernio, ...patch }, rev: nextSettingsRev(raw) };
    const syncedPath = "settings->zernio->>synced_at" as "id";
    const revPath = "settings->>rev" as "id";
    let q = db
      .from("bots")
      .update({ settings: next as never })
      .eq("id", botId);
    q = prevSyncedAt === null ? q.is(syncedPath, null as never) : q.eq(syncedPath, prevSyncedAt);
    q = rev === null ? q.is(revPath, null as never) : q.eq(revPath, String(rev));
    const { data: rows, error: writeError } = await q.select("id");
    if (writeError) throw serverFailure(`bots.settings: ${writeError.message}`);
    if (rows?.length) {
      invalidateTenantDirectory();
      return true;
    }
  }
  return false;
}

/** Что страж каналов записал в bots.settings.zernio.guard (свежее чтение, не кеш). */
export async function readZernioGuard(
  botId: string,
): Promise<Partial<Record<"instagram" | "whatsapp", ChannelGuardEntry>>> {
  const { data, error } = await serviceDb()
    .from("bots")
    .select("settings")
    .eq("id", botId)
    .maybeSingle();
  if (error)
    throw serverFailure(`bots.settings: страж каналов не прочитал настройки (${error.message})`);
  const guard = asObject(asObject(asObject(data?.settings).zernio).guard);
  return guard as Partial<Record<"instagram" | "whatsapp", ChannelGuardEntry>>;
}

/**
 * Поменять запись стража одного канала, только если она всё ещё `expected`
 * (null — записи нет). Выигрывает один из конкурентов: два крона или крон и
 * событие вебхука, прочитавшие одно и то же, — запишет и отправит сообщение
 * только первый, второй получит false. Запись условна по `settings.rev`, а не
 * по всему jsonb; если ключ settings поменял кто-то другой, перечитываем.
 */
export async function swapZernioGuard(
  botId: string,
  platform: "instagram" | "whatsapp",
  expected: ChannelGuardEntry | null,
  next: ChannelGuardEntry | null,
): Promise<boolean> {
  const db = serviceDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.from("bots").select("settings").eq("id", botId).maybeSingle();
    if (error)
      throw serverFailure(`bots.settings: страж каналов не прочитал настройки (${error.message})`);
    if (!data) throw serverFailure(`bots.settings: магазин ${botId} не найден`);
    const raw = asObject(data.settings);
    const zernio = asObject(raw.zernio);
    const guard = { ...asObject(zernio.guard) };
    const current = (guard[platform] as ChannelGuardEntry | undefined) ?? null;
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
    if (next) guard[platform] = next;
    else delete guard[platform];
    const rev = settingsRev(raw);
    const nextSettings = { ...raw, zernio: { ...zernio, guard }, rev: nextSettingsRev(raw) };
    const revPath = "settings->>rev" as "id";
    let q = db
      .from("bots")
      .update({ settings: nextSettings as never })
      .eq("id", botId);
    q = rev === null ? q.is(revPath, null as never) : q.eq(revPath, String(rev));
    const { data: rows, error: writeError } = await q.select("id");
    if (writeError) throw serverFailure(`bots.settings: ${writeError.message}`);
    if (rows?.length) {
      invalidateTenantDirectory();
      return true;
    }
  }
  return false;
}

/**
 * Изменить bots.settings.admin (пользователи и приглашения команды): прочитать,
 * решить `update`, записать условно по `settings.rev`. `update` получает
 * текущую запись admin и возвращает новую; null — ничего не менять (false).
 * Гонка (два принятия одного приглашения, владелец правит команду) → перечитываем
 * и решаем заново, поэтому одно приглашение принимается ровно один раз. Чужие
 * ключи settings не затираем; не удалось прочитать — не пишем.
 */
export async function updateAdminSettings(
  botId: string,
  update: (admin: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<boolean> {
  const db = serviceDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await db.from("bots").select("settings").eq("id", botId).maybeSingle();
    if (error)
      throw serverFailure(`bots.settings: команда не прочитала настройки (${error.message})`);
    if (!data) throw serverFailure(`bots.settings: магазин ${botId} не найден`);
    const raw = asObject(data.settings);
    const admin = asObject(raw.admin);
    const nextAdmin = update(admin);
    if (!nextAdmin) return false;
    const rev = settingsRev(raw);
    const next = { ...raw, admin: nextAdmin, rev: nextSettingsRev(raw) };
    const revPath = "settings->>rev" as "id";
    let q = db
      .from("bots")
      .update({ settings: next as never })
      .eq("id", botId);
    q = rev === null ? q.is(revPath, null as never) : q.eq(revPath, String(rev));
    const { data: rows, error: writeError } = await q.select("id");
    if (writeError) throw serverFailure(`bots.settings: ${writeError.message}`);
    if (rows?.length) {
      invalidateTenantDirectory();
      return true;
    }
  }
  throw serverFailure("bots.settings: команда не записана — настройки менялись слишком часто");
}

/**
 * Запись мастера подключения одного канала (settings.zernio.wizard): прочитать,
 * решить `update`, записать условно по `settings.rev`. `update` получает
 * текущую запись и возвращает новую; undefined — ничего не менять. Гонка
 * (продавец, крон, входящее сообщение в один миг) → перечитываем и решаем
 * заново, чужие ключи settings не затираем. Возвращает записанную запись.
 */
export async function updateZernioWizard(
  botId: string,
  platform: "instagram" | "whatsapp",
  update: (current: WizardEntry | undefined) => WizardEntry | undefined,
): Promise<WizardEntry | undefined> {
  const db = serviceDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.from("bots").select("settings").eq("id", botId).maybeSingle();
    if (error)
      throw serverFailure(`bots.settings: мастер каналов не прочитал настройки (${error.message})`);
    if (!data) throw serverFailure(`bots.settings: магазин ${botId} не найден`);
    const raw = asObject(data.settings);
    const zernio = asObject(raw.zernio);
    const wizard = { ...asObject(zernio.wizard) };
    const current = (wizard[platform] as WizardEntry | undefined) ?? undefined;
    const next = update(current);
    if (!next) return current;
    wizard[platform] = next;
    const rev = settingsRev(raw);
    const nextSettings = { ...raw, zernio: { ...zernio, wizard }, rev: nextSettingsRev(raw) };
    const revPath = "settings->>rev" as "id";
    let q = db
      .from("bots")
      .update({ settings: nextSettings as never })
      .eq("id", botId);
    q = rev === null ? q.is(revPath, null as never) : q.eq(revPath, String(rev));
    const { data: rows, error: writeError } = await q.select("id");
    if (writeError) throw serverFailure(`bots.settings: ${writeError.message}`);
    if (rows?.length) {
      invalidateTenantDirectory();
      return next;
    }
  }
  throw serverFailure(`bots.settings: мастер каналов не записал состояние ${botId} (гонка версий)`);
}

export async function resolveTenant(lookup: TenantLookup): Promise<Tenant | null> {
  const found = findTenant(await tenantDirectory(), lookup);
  if (found) return found;
  // Промах по кешу может быть свежим клиентом — один раз перечитываем.
  return findTenant(await tenantDirectory(true), lookup);
}

/** Арендатор события Zernio: по аккаунту, иначе по профилю (directory.ts findZernioTenant). */
export async function resolveZernioTenant(accountId: string | null, profileId: string | null) {
  const found = findZernioTenant(await tenantDirectory(), accountId, profileId);
  if (found) return found;
  return findZernioTenant(await tenantDirectory(true), accountId, profileId);
}

export class TenantNotFound extends Error {
  constructor(public readonly lookup: TenantLookup) {
    super(`Арендатор не найден (${lookup.by}=${lookup.value})`);
  }
}

export async function requireTenant(lookup: TenantLookup): Promise<Tenant> {
  const t = await resolveTenant(lookup);
  if (!t) throw new TenantNotFound(lookup);
  return t;
}

/**
 * Контекст запроса: всё, что нужно домену, чтобы работать от имени одного
 * клиента. Домен не читает окружение и не знает, из какого канала пришла
 * команда — только это.
 */
export type TenantContext = {
  tenant: Tenant;
  /** Подключение под ролью арендатора — видит только его строки. */
  db: Db;
  /** Публичный адрес платформы: ссылки в сообщениях, колбэки оплаты. */
  appUrl: string;
  /** Часовой пояс для дат получения. */
  timezone: string;
  secrets: {
    telegramToken(): string;
    /** Токен VIP-бота (settings.vip.token_enc); бросает, если VIP-бот не подключён. */
    vipToken(): string;
  };
};

/**
 * Контекст запроса клиента: админка, бот, витрина, кроны. Модули в нём — только
 * готовые (availableModules): planned-флаг из базы не открывает ничего.
 */
export function tenantContext(raw: Tenant): TenantContext {
  const { APP_URL, SECRETS_KEY, APP_TIMEZONE } = env();
  const tenant: Tenant = { ...raw, modules: availableModules(raw.modules) };
  return {
    tenant,
    db: tenantDb(tenant.id),
    appUrl: APP_URL,
    timezone: tenant.settings.timezone ?? APP_TIMEZONE,
    secrets: {
      telegramToken() {
        const enc = tenant.telegramTokenEnc;
        if (!isEncryptedSecret(enc)) {
          throw new Error(`У клиента «${tenant.name}» не подключён Telegram-бот (нет токена)`);
        }
        return decryptSecret(enc, SECRETS_KEY);
      },
      vipToken() {
        const enc = tenant.settings.vip?.token_enc;
        if (!isEncryptedSecret(enc)) {
          throw new Error(`У клиента «${tenant.name}» не подключён VIP-бот (нет токена)`);
        }
        return decryptSecret(enc, SECRETS_KEY);
      },
    },
  };
}
