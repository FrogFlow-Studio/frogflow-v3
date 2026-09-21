import { serviceDb, tenantDb, type Db } from "@/core/db/client.server";
import { env } from "@/config/env";
import { decryptSecret, isEncryptedSecret } from "@/core/secrets/vault";
import { findTenant, tenantFromRow, TENANT_COLUMNS, type TenantRow } from "./directory";
import type { Tenant, TenantLookup } from "./types";

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
  if (error) throw new Error(`Не удалось прочитать справочник арендаторов: ${error.message}`);
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
  const { data } = await db.from("bots").select("settings").eq("id", botId).maybeSingle();
  const raw =
    data?.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};
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
  const { error } = await db
    .from("bots")
    .update({ settings: next as never })
    .eq("id", botId);
  if (error) throw new Error(`bots.settings: ${error.message}`);
  invalidateTenantDirectory();
}

export async function resolveTenant(lookup: TenantLookup): Promise<Tenant | null> {
  const found = findTenant(await tenantDirectory(), lookup);
  if (found) return found;
  // Промах по кешу может быть свежим клиентом — один раз перечитываем.
  return findTenant(await tenantDirectory(true), lookup);
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

export function tenantContext(tenant: Tenant): TenantContext {
  const { APP_URL, SECRETS_KEY, APP_TIMEZONE } = env();
  return {
    tenant,
    db: tenantDb(tenant.id),
    appUrl: APP_URL,
    timezone: APP_TIMEZONE,
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
