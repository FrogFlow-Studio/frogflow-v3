import { isReservedSlug } from "./slug";
import { signupOrigin } from "@/core/signup/origin";
import { MODULE_KEYS, type ModuleKey } from "@/core/modules/registry";
import { VERTICALS, type VerticalKey } from "@/core/verticals/registry";
import type { Database } from "@/core/db-types";
import type { BillingSettings, BotStatus, Tenant, TenantLookup, TenantSettings } from "./types";
import { isLocale } from "@/core/i18n/locale";
import { effectiveModules } from "@/core/plans/plans";
import { parsePlan } from "@/core/plans/registry";
import { validPauseHours } from "@/core/consultant/pause";

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
  const mb = obj(s.multi_bot);
  const served = s.served_by === "v2" ? "v2" : s.served_by === "v1" ? "v1" : undefined;
  // Пределы ИИ: только числа, остальное — null («общий предел»).
  const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const cl = s.consultant_limits;
  const sl = s.smart_search_limits;
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
      ice_breakers_v: str(zr.ice_breakers_v),
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
              // Неизвестная роль — самая узкая (просмотр), а не менеджер.
              role:
                u.role === "manager" || u.role === "accountant"
                  ? (u.role as "manager" | "accountant")
                  : ("viewer" as const),
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
    multi_bot: str(mb.group) ? { group: str(mb.group)!.toLowerCase() } : undefined,
    served_by: served,
    served_by_since:
      typeof s.served_by_since === "string" && !Number.isNaN(Date.parse(s.served_by_since))
        ? s.served_by_since
        : undefined,
    // Откуда пришёл продавец: из браузера при регистрации — перепроверяем при чтении.
    signup: signupOrigin(obj(s.signup)) ?? undefined,
    on_overdue:
      s.on_overdue === "suspend" ? "suspend" : s.on_overdue === "warn" ? "warn" : undefined,
    warn_days_before: typeof s.warn_days_before === "number" ? s.warn_days_before : undefined,
    grace_days: typeof s.grace_days === "number" ? s.grace_days : undefined,
    billing: billingFromJson(s.billing),
    consultant_limits:
      cl && typeof cl === "object" && !Array.isArray(cl)
        ? {
            daily_usd: numOrNull(obj(cl).daily_usd),
            daily_calls: numOrNull(obj(cl).daily_calls),
            daily_tests: numOrNull(obj(cl).daily_tests),
          }
        : undefined,
    consultant_pause_hours: validPauseHours(s.consultant_pause_hours),
    smart_search_limits:
      sl && typeof sl === "object" && !Array.isArray(sl)
        ? { daily_usd: numOrNull(obj(sl).daily_usd) }
        : undefined,
    delivery:
      s.delivery && typeof s.delivery === "object" && !Array.isArray(s.delivery)
        ? { pdf_watermark: obj(s.delivery).pdf_watermark === true }
        : undefined,
    gift_sale:
      s.gift_sale && typeof s.gift_sale === "object" && !Array.isArray(s.gift_sale)
        ? {
            enabled: obj(s.gift_sale).enabled === true,
            amounts: Array.isArray(obj(s.gift_sale).amounts)
              ? (obj(s.gift_sale).amounts as unknown[]).filter(
                  (x): x is number => typeof x === "number" && Number.isFinite(x),
                )
              : [],
            currency: str(obj(s.gift_sale).currency),
          }
        : undefined,
  };
}

function billingFromJson(json: unknown): BillingSettings | undefined {
  if (!json || typeof json !== "object" || Array.isArray(json)) return undefined;
  const b = json as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const quota = (v: unknown) =>
    v === null ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  const q =
    b.ai_quota && typeof b.ai_quota === "object" && !Array.isArray(b.ai_quota)
      ? (b.ai_quota as Record<string, unknown>)
      : null;
  return {
    plan: str(b.plan),
    addons: Array.isArray(b.addons)
      ? b.addons.filter((a): a is "whatsapp" | "instagram" => a === "whatsapp" || a === "instagram")
      : undefined,
    grandfathered: Array.isArray(b.grandfathered)
      ? b.grandfathered.filter(
          (k): k is ModuleKey => typeof k === "string" && (MODULE_KEYS as string[]).includes(k),
        )
      : undefined,
    ai_quota: q
      ? { ai_dialogs: quota(q.ai_dialogs), receipt_checks: quota(q.receipt_checks) }
      : undefined,
    period: b.period === "year" ? "year" : b.period === "month" ? "month" : undefined,
    connection_paid_at: str(b.connection_paid_at),
    connection_invoice_id: str(b.connection_invoice_id),
    plan_version: typeof b.plan_version === "number" ? b.plan_version : undefined,
    trial_until: str(b.trial_until),
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

/**
 * Флаги модулей клиента. У клиента v2 на плане к флагам из `bots.modules`
 * добавляется план (effectiveModules): флаги пишутся в базу только при
 * смене плана, и модуль, который стал готовым позже (курсы), иначе не
 * открылся бы, пока оператор не пересохранит план руками. Включённое в базе
 * не убирается: ничего купленного молча не пропадает, а выключить модуль
 * оператор может только записью в базу (сверх плана — через «сохранённые»,
 * модуль плана — сменой плана). Клиент v1, custom и без плана — как в базе.
 */
function tenantModules(row: TenantRow, settings: TenantSettings): Record<ModuleKey, boolean> {
  const saved = modulesFromJson(row.modules);
  const plan = parsePlan(settings.billing?.plan ?? null);
  const fromPlan = settings.served_by === "v2" ? effectiveModules(plan, settings.billing) : null;
  if (!fromPlan) return saved;
  const out = { ...saved };
  for (const k of MODULE_KEYS) if (fromPlan[k]) out[k] = true;
  return out;
}

export function tenantFromRow(row: TenantRow): Tenant {
  const settings = settingsFromJson(row.settings);
  return {
    id: row.id,
    name: row.bot_name,
    status: asStatus(row.status),
    vertical: asVertical(row.vertical),
    modules: tenantModules(row, settings),
    settings,
    pausedMessage: row.paused_message,
    ownerTelegramId: row.owner_telegram_id,
    appUrl: row.app_url,
    archived: row.archived_at != null,
    telegramTokenEnc: row.bot_token,
    // Ключ плана — в settings: колонка subscription_plan хранит только уровень (core/plans).
    plan: settings.billing?.plan ?? null,
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

/** Имя клиента, к которому уже подключён Telegram-бот с этим username, или null. */
export function telegramBotTaken(
  directory: readonly Tenant[],
  botId: string,
  username: string | null | undefined,
): string | null {
  const u = username?.trim().toLowerCase();
  if (!u) return null;
  const other = directory.find(
    (t) => t.id !== botId && t.settings.telegram?.username?.toLowerCase() === u,
  );
  return other ? other.name : null;
}

const only = (list: Tenant[]): Tenant | null => (list.length === 1 ? list[0]! : null);

/**
 * Занят ли короткий адрес или домен другим клиентом. Возвращает имя клиента,
 * у которого занято, — для сообщения оператору, — или null.
 */
export function addressConflict(
  directory: readonly Tenant[],
  botId: string | null,
  want: { slug?: string | null; hosts?: readonly string[] },
): { what: string; owner: string } | null {
  const slug = want.slug?.trim().toLowerCase();
  const hosts = (want.hosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  // Служебный адрес занят платформой; клиент, у которого он уже стоит, его сохраняет.
  const own = botId ? directory.find((t) => t.id === botId) : null;
  if (slug && isReservedSlug(slug) && own?.settings.slug !== slug)
    return { what: slug, owner: "FrogFlow" };
  for (const t of directory) {
    if (t.id === botId) continue;
    if (slug && t.settings.slug === slug) return { what: slug, owner: t.name };
    const h = hosts.find((x) => t.settings.hosts?.includes(x));
    if (h) return { what: h, owner: t.name };
  }
  return null;
}

/**
 * Арендатор события Zernio. Сначала по аккаунту (bots.settings.zernio.account_ids).
 * Если аккаунт не записан ни у кого — по профилю: при переподключении Instagram
 * или WhatsApp id аккаунта у Zernio меняется, а id профиля нет, и до сверки
 * аккаунтов события иначе терялись бы. Аккаунт, записанный у другого клиента
 * (или у двух сразу), профилем не перехватывается.
 */
export function findZernioTenant(
  directory: readonly Tenant[],
  accountId: string | null,
  profileId: string | null,
): { tenant: Tenant; via: "account" | "profile" } | null {
  const account = accountId?.trim().toLowerCase();
  if (account) {
    const owners = directory.filter((t) =>
      t.settings.zernio?.account_ids?.some((a) => a.toLowerCase() === account),
    );
    if (owners.length === 1) return { tenant: owners[0]!, via: "account" };
    if (owners.length > 1) return null;
  }
  const profile = profileId?.trim().toLowerCase();
  if (!profile) return null;
  const tenant = only(
    directory.filter((t) => t.settings.zernio?.profile_id?.toLowerCase() === profile),
  );
  return tenant ? { tenant, via: "profile" } : null;
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
    // Адрес, записанный у двух клиентов, — ничей, как и аккаунт Zernio ниже:
    // иначе витрину отдал бы «первый попавшийся», и новый клиент с тем же
    // slug перехватил бы чужой магазин. Запись дублей закрывает addressConflict.
    case "slug":
      return only(directory.filter((t) => t.settings.slug === value));
    case "host": {
      const host = value.replace(/:\d+$/, "");
      const byHost = directory.filter((t) => t.settings.hosts?.includes(host));
      if (byHost.length > 1) return null;
      return byHost[0] ?? directory.find((t) => hostOf(t.appUrl) === host) ?? null;
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
