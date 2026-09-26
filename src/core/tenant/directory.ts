import { MODULE_KEYS, type ModuleKey } from "@/core/modules/registry";
import { VERTICALS, type VerticalKey } from "@/core/verticals/registry";
import type { Database } from "@/core/db-types";
import type { BotStatus, Tenant, TenantLookup, TenantSettings } from "./types";
import { isLocale } from "@/core/i18n/locale";

type BotRow = Database["public"]["Tables"]["bots"]["Row"];

/** Колонки `bots`, которые нужны справочнику арендаторов. */
export const TENANT_COLUMNS =
  "id, bot_name, status, vertical, modules, settings, paused_message, owner_telegram_id, app_url, archived_at, bot_token" as const;

export type TenantRow = Pick<
  BotRow,
  | "id"
  | "bot_name"
  | "status"
  | "vertical"
  | "modules"
  | "settings"
  | "paused_message"
  | "owner_telegram_id"
  | "app_url"
  | "archived_at"
  | "bot_token"
>;

function asStatus(value: string | null): BotStatus {
  return value === "paused" || value === "suspended" ? value : "active";
}

function asVertical(value: string | null | undefined): VerticalKey {
  return value && value in VERTICALS ? (value as VerticalKey) : "digital";
}

/**
 * Полный канонический набор модулей: ключи реестра, которых нет в строке,
 * читаются как выключенные. Второго списка ключей нет — реестр один.
 */
export function modulesFromJson(json: unknown): Record<ModuleKey, boolean> {
  const src =
    json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  const result = {} as Record<ModuleKey, boolean>;
  for (const key of MODULE_KEYS) result[key] = src[key] === true;
  return result;
}

export function settingsFromJson(json: unknown): TenantSettings {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const s = json as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const strList = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
      : undefined;
  const obj = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const tg = obj(s.telegram);
  const zr = obj(s.zernio);
  const adm = obj(s.admin);
  const vip = obj(s.vip);
  const served = s.served_by === "v2" ? "v2" : s.served_by === "v1" ? "v1" : undefined;
  return {
    slug: str(s.slug)?.toLowerCase(),
    hosts: strList(s.hosts)?.map((h) => h.toLowerCase()),
    default_locale: isLocale(s.default_locale) ? s.default_locale : undefined,
    timezone: validTimezone(str(s.timezone)),
    telegram: { username: str(tg.username), webhook_ok: tg.webhook_ok === true },
    zernio: {
      profile_id: str(zr.profile_id),
      account_ids: strList(zr.account_ids),
      accounts: Array.isArray(zr.accounts)
        ? zr.accounts
            .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
            .map((a) => ({
              id: String(a.id ?? ""),
              platform: String(a.platform ?? ""),
              username: str(a.username),
              name: str(a.name),
              expired: a.expired === true,
            }))
            .filter((a) => a.id)
        : undefined,
      synced_at: str(zr.synced_at),
    },
    admin: {
      username: str(adm.username),
      password_hash: str(adm.password_hash),
      users: Array.isArray(adm.users)
        ? adm.users
            .filter((u): u is Record<string, unknown> => Boolean(u) && typeof u === "object")
            .map((u) => ({
              username: String(u.username ?? "").toLowerCase(),
              password_hash: String(u.password_hash ?? ""),
              role: u.role === "viewer" ? ("viewer" as const) : ("manager" as const),
              name: str(u.name),
              created_at: str(u.created_at),
            }))
            .filter((u) => u.username && u.password_hash)
        : undefined,
    },
    vip: {
      token_enc: str(vip.token_enc),
      username: str(vip.username),
      webhook_ok: vip.webhook_ok === true,
    },
    served_by: served,
    on_overdue:
      s.on_overdue === "suspend" ? "suspend" : s.on_overdue === "warn" ? "warn" : undefined,
    warn_days_before: typeof s.warn_days_before === "number" ? s.warn_days_before : undefined,
    grace_days: typeof s.grace_days === "number" ? s.grace_days : undefined,
  };
}

/**
 * Клиент переезжает на v2 явным переключателем оператора
 * (`settings.served_by = "v2"`). До этого его обслуживает прежняя платформа,
 * и v2 для него невидима: не пускает в админку и на витрину, не выдаёт
 * заказы, не чистит журналы, не трогает вебхуки. Оба деплоя работают на
 * одной базе одновременно, поэтому граница — только этот флаг.
 */
export function servedByV2(t: Pick<Tenant, "settings">): boolean {
  return t.settings.served_by === "v2";
}

export function tenantFromRow(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.bot_name,
    status: asStatus(row.status),
    vertical: asVertical(row.vertical),
    modules: modulesFromJson(row.modules),
    settings: settingsFromJson(row.settings),
    pausedMessage: row.paused_message,
    ownerTelegramId: row.owner_telegram_id,
    appUrl: row.app_url,
    archived: row.archived_at != null,
    telegramTokenEnc: row.bot_token,
  };
}

/** Только настоящий IANA-пояс: битое значение не должно валить форматирование дат. */
export function validTimezone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Поиск арендатора в справочнике — чистая функция, чтобы правила
 * сопоставления проверялись тестами без базы. Справочник — все неархивные
 * строки `bots`; при десятках клиентов это дешевле любых jsonb-запросов
 * и не зависит от индексов, которых в схеме нет.
 */
export function findTenant(directory: readonly Tenant[], lookup: TenantLookup): Tenant | null {
  const value = lookup.value.trim().toLowerCase();
  if (!value) return null;
  switch (lookup.by) {
    case "id":
      return directory.find((t) => t.id.toLowerCase() === value) ?? null;
    case "slug":
      return directory.find((t) => t.settings.slug === value) ?? null;
    case "host": {
      const host = value.replace(/:\d+$/, "");
      return (
        directory.find((t) => t.settings.hosts?.includes(host)) ??
        directory.find((t) => hostOf(t.appUrl) === host) ??
        null
      );
    }
    case "zernio_account": {
      // Аккаунт, записанный у двух клиентов, — ничей: событие не должно
      // уйти «первому попавшемуся» (core/tenant/zernio-accounts.ts).
      const owners = directory.filter((t) =>
        t.settings.zernio?.account_ids?.some((a) => a.toLowerCase() === value),
      );
      return owners.length === 1 ? owners[0]! : null;
    }
  }
}
