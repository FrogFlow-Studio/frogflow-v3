import { serviceDb } from "@/core/db/client.server";
import { patchTenantSettings, requireTenant } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { logEvent } from "./client-log.server";
import { effectiveRateSource } from "@/core/consultant/pricelist/rate";

/** Консультант, умный поиск и витрина клиента: бюджеты и лимиты. */

/** Дневной предел ИИ-консультанта клиента: свой или общий, и сколько потрачено сегодня. */
export async function consultantBudget(botId: string) {
  const { CONSULTANT_LIMITS, CONSULTANT_LIMIT_MAX, limitsFor, parseDaily, today } =
    await import("@/core/consultant/budget");
  const t = await requireTenant({ by: "id", value: botId });
  const { data, error: readErr2 } = await serviceDb()
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId)
    .eq("key", "consultant_daily")
    .maybeSingle();
  if (readErr2)
    throw serverFailure(`[operator] расход консультанта не прочитан: ${readErr2.message}`);
  const custom = t.settings.consultant_limits ?? null;
  return {
    limits: limitsFor(custom),
    custom: Boolean(
      custom && [custom.daily_usd, custom.daily_calls, custom.daily_tests].some((v) => v != null),
    ),
    defaults: CONSULTANT_LIMITS,
    max: CONSULTANT_LIMIT_MAX,
    today: parseDaily(data?.value, today()),
    search: t.settings.consultant_search === true,
    pricelist: t.settings.consultant_pricelist?.enabled === true,
    pricelistOptions: {
      hours: t.settings.consultant_pricelist?.hours ?? null,
      rateSource: effectiveRateSource(t.settings.consultant_pricelist),
      rateUrl: t.settings.consultant_pricelist?.rate_url ?? "",
    },
  };
}

/** Оператор скрывает магазин с площадки FrogFlow или возвращает (core/marketplace). */
export async function setMarketplaceHidden(
  botId: string,
  hidden: boolean,
  reason: string,
  actor = "operator",
) {
  const { setMarketplaceHidden: set } = await import("@/core/marketplace/settings.server");
  await set(botId, hidden, reason);
  await logEvent(
    botId,
    "meta",
    { marketplace_hidden: hidden, reason: reason.slice(0, 300) },
    actor,
  );
}

/** Поиск консультанта по каталогу инструментом (core/consultant/catalog-tool.server). */
export async function setConsultantSearch(botId: string, on: boolean, actor = "operator") {
  await patchTenantSettings(botId, { consultant_search: on });
  await logEvent(botId, "meta", { consultant_search: on }, actor);
}

/** Консультант «по прайсу» BOVI (core/consultant/pricelist) — включает оператор. */
export async function setConsultantPricelist(botId: string, on: boolean, actor = "operator") {
  await patchTenantSettings(botId, { consultant_pricelist: { enabled: on } });
  await logEvent(botId, "meta", { consultant_pricelist: on }, actor);
}

/**
 * Часы магазина, источник курса и страница банка на finkaz для консультанта
 * по прайсу. Проверка значений — та же, что при чтении (settingsFromJson):
 * записываем только то, что потом прочтётся.
 */
export async function setConsultantPricelistOptions(
  botId: string,
  o: {
    hours: { open: number; close: number } | null;
    rateSource: "vtb" | "finkaz" | "manual";
    rateUrl: string;
  },
  actor = "operator",
) {
  const h = o.hours;
  if (h && (h.open === h.close || [h.open, h.close].some((n) => !(n >= 0 && n <= 24))))
    throw new Error("Часы работы — от 0 до 24, открытие и закрытие не совпадают.");
  const url = o.rateUrl.trim();
  if (url && !/^https:\/\/finkaz\.kz\/[a-z0-9-]+\/exchange-rates\/?$/i.test(url))
    throw new Error("Страница курса — адрес вида https://finkaz.kz/kaspi-bank/exchange-rates.");
  const patch = {
    hours: h ?? undefined,
    rate_source: o.rateSource,
    rate_url: url || undefined,
  };
  await patchTenantSettings(botId, { consultant_pricelist: patch });
  await logEvent(botId, "meta", { consultant_pricelist_options: patch }, actor);
}

/** Дневной предел умного поиска клиента в долларах: свой или общий, и расход сегодня. */
export async function smartSearchBudget(botId: string) {
  const { DAILY_USD_LIMIT, SMART_SEARCH_USD_MAX, dailySpendUsd, smartSearchUsdLimit } =
    await import("@/core/search/smart-pure");
  const t = await requireTenant({ by: "id", value: botId });
  const { data, error: readErr } = await serviceDb()
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId)
    .eq("key", "smart_search_daily_spend")
    .maybeSingle();
  if (readErr)
    throw serverFailure(`[operator] расход умного поиска не прочитан: ${readErr.message}`);
  const custom = t.settings.smart_search_limits?.daily_usd;
  return {
    limitUsd: smartSearchUsdLimit(t.settings.smart_search_limits),
    custom: typeof custom === "number",
    defaultUsd: DAILY_USD_LIMIT,
    maxUsd: SMART_SEARCH_USD_MAX,
    todayUsd: dailySpendUsd(data?.value),
  };
}

/** Свой предел умного поиска; null — общий предел платформы. */
export async function setSmartSearchLimit(
  botId: string,
  dailyUsd: number | null,
  actor = "operator",
) {
  const value = dailyUsd == null ? null : { daily_usd: dailyUsd };
  await patchTenantSettings(botId, { smart_search_limits: value });
  await logEvent(botId, "meta", { smart_search_limits: value }, actor);
}

/** Свой предел клиента; null — вернуть общий предел платформы. */
export async function setConsultantLimits(
  botId: string,
  limits: { dailyUsd: number | null; dailyCalls: number | null; dailyTests: number | null } | null,
  actor = "operator",
) {
  const value = limits
    ? { daily_usd: limits.dailyUsd, daily_calls: limits.dailyCalls, daily_tests: limits.dailyTests }
    : null;
  await patchTenantSettings(botId, { consultant_limits: value });
  await logEvent(botId, "meta", { consultant_limits: value }, actor);
}
