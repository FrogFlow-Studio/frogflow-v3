import type { TenantContext } from "@/core/tenant/resolve.server";
import { env } from "@/config/env";
import { getSetting, setSetting } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { attemptText, errorAttempt, parseAttempts, type RateAttempt } from "./rate-attempts";
import { bankNameFromFinkazUrl, parseFinkazRubQuote } from "./finkaz-parse";
import { effectiveRateSource, parseStoredRate, type StoredVtbRate } from "./rate";
import {
  parseVtbRateQuote,
  rateSourceKind,
  type RateSourceKind,
  type VtbRateQuote,
} from "./vtb-parse";

/**
 * Курс рубля для консультанта по прайсу (перенос src/lib/consultant/vtb.ts и
 * чтения из rate.ts v1). Те же строки app_settings: `consultant_vtb_buy_rate`
 * — курс, `consultant_vtb_last_error` — журнал последней попытки. Источник —
 * настройка магазина `consultant_pricelist.rate_source` (в v1 — переменная
 * окружения деплоя клиента), ретранслятор ВТБ — окружение платформы.
 */
export const VTB_RATE_KEY = "consultant_vtb_buy_rate";
export const VTB_LAST_ERROR_KEY = "consultant_vtb_last_error";
export const VTB_ONLINE_API_URL = "https://online-api.vtb.kz/api/exchange-rate/by-currencyMob/";
export const FINKAZ_KASPI_URL = "https://finkaz.kz/kaspi-bank/exchange-rates";

/** Одна попытка — шесть секунд, весь обход — не больше двадцати (лимит функции). */
const FETCH_MS = 6_000;
const TOTAL_BUDGET_MS = 20_000;
/** Курс со страницы старше суток не берём: сайт мог застыть. */
const SOURCE_MAX_AGE_HOURS = 24;
/** Скачок больше 15% к курсу моложе трёх суток — скорее съехавшая разметка чужого сайта. */
const MAX_RATE_JUMP = 0.15;
const JUMP_GUARD_MAX_AGE_HOURS = 72;
const CACHE_MS = 60_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** `attempts` — русские строки (оператор, v1); `entries` — коды для панели на языке продавца. */
export type VtbAttemptLog = {
  at: string;
  ok: boolean;
  attempts: string[];
  entries?: RateAttempt[];
};
type Fetch = typeof fetch;

const cache = new Map<string, { at: number; value: StoredVtbRate | null }>();

/**
 * Последний сохранённый курс. Сбой чтения — не «курса нет» (v1, 22.09: бот
 * трижды сказал «курс недоступен» при живом курсе): ошибка не кэшируется,
 * отдаётся последнее прочитанное.
 */
export async function getStoredRate(
  ctx: TenantContext,
  now = Date.now(),
): Promise<StoredVtbRate | null> {
  return readStoredRate(ctx, now, false);
}

/**
 * Курс для панели («Обзор»): сбой чтения — ошибка, а не «курса нет». Бот
 * берёт `getStoredRate` (там сбой отдаёт последнее прочитанное), а продавцу
 * ложное предупреждение «курса нет» при живом курсе не нужно.
 */
export async function getStoredRateStrict(
  ctx: TenantContext,
  now = Date.now(),
): Promise<StoredVtbRate | null> {
  return readStoredRate(ctx, now, true);
}

async function readStoredRate(
  ctx: TenantContext,
  now: number,
  strict: boolean,
): Promise<StoredVtbRate | null> {
  const hit = cache.get(ctx.tenant.id);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", VTB_RATE_KEY)
    .maybeSingle();
  if (error) {
    if (strict) throw serverFailure(`курс не прочитан: ${error.message}`);
    console.warn(`[rate:${ctx.tenant.id}] курс не прочитан: ${error.message}`);
    return hit?.value ?? null;
  }
  const raw = (data as { value?: string | null } | null)?.value ?? null;
  const value = parseStoredRate(raw);
  if (raw?.trim() && !value) return hit?.value ?? null; // испорчено — не «нет курса»
  cache.set(ctx.tenant.id, { at: now, value });
  return value;
}

/**
 * Курс для цены покупателю: последний сохранённый, какой бы старый ни был.
 * Старше суток (isRateFresh — false) рубли уходят с пометкой
 * «ориентировочно», а оператор узнаёт о сломанном источнике через шесть
 * часов (platform-alerts). Нет курса вовсе — null, цены в тенге.
 */
export async function getUsableRate(
  ctx: TenantContext,
  now = Date.now(),
): Promise<StoredVtbRate | null> {
  return getStoredRate(ctx, now);
}

export async function saveRate(
  ctx: TenantContext,
  rate: number,
  source: string,
  sell?: number,
  now = new Date(),
): Promise<StoredVtbRate> {
  const stored: StoredVtbRate = {
    rate,
    updatedAt: now.toISOString(),
    source,
    ...(sell && sell > 0 ? { sell } : {}),
  };
  await setSetting(ctx, VTB_RATE_KEY, JSON.stringify(stored));
  cache.set(ctx.tenant.id, { at: now.getTime(), value: stored });
  return stored;
}

export async function saveAttemptLog(ctx: TenantContext, log: VtbAttemptLog): Promise<void> {
  await setSetting(ctx, VTB_LAST_ERROR_KEY, JSON.stringify(log)).catch(() => {});
}

/** Журнал попытки в двух формах сразу: строки и коды. */
function attemptLog() {
  const entries: RateAttempt[] = [];
  const lines: string[] = [];
  return {
    entries,
    lines,
    push(a: RateAttempt) {
      entries.push(a);
      lines.push(attemptText(a));
    },
    save(ctx: TenantContext, at: string, ok: boolean) {
      return saveAttemptLog(ctx, { at, ok, attempts: [...lines], entries: [...entries] });
    },
  };
}

export async function loadAttemptLog(ctx: TenantContext): Promise<VtbAttemptLog | null> {
  try {
    const p = JSON.parse(
      (await getSetting(ctx, VTB_LAST_ERROR_KEY)) ?? "",
    ) as Partial<VtbAttemptLog>;
    if (!p.at) return null;
    return {
      at: String(p.at),
      ok: Boolean(p.ok),
      attempts: Array.isArray(p.attempts) ? p.attempts.map(String).slice(0, 8) : [],
      ...(parseAttempts(p.entries) ? { entries: parseAttempts(p.entries) } : {}),
    };
  } catch {
    return null;
  }
}

/** «Kaspi (finkaz.kz)» — то, что видит продавец в панели. */
export function rateSourceLabel(source: string | undefined): string {
  if (!source) return "источник неизвестен";
  if (source === "manual") return "введён вручную";
  const bank = bankNameFromFinkazUrl(source);
  if (bank) return `${bank} (finkaz.kz)`;
  if (/vtb/i.test(source)) return "ВТБ Онлайн";
  return source;
}

export function errorText(err: unknown): string {
  return attemptText(errorAttempt(err));
}

/** Скачок курса к прошлому (доля) или null — в норме или сравнивать не с чем. */
export function rateJump(
  previous: StoredVtbRate | null,
  next: number,
  now = Date.now(),
): number | null {
  if (!previous?.rate || !(previous.rate > 0)) return null;
  const ageHours = (now - Date.parse(previous.updatedAt)) / 36e5;
  if (!Number.isFinite(ageHours) || ageHours > JUMP_GUARD_MAX_AGE_HOURS) return null;
  const diff = Math.abs(next - previous.rate) / previous.rate;
  return diff > MAX_RATE_JUMP ? diff : null;
}

async function readFinkaz(
  url: string,
  fetchImpl: Fetch,
  now: number,
): Promise<{
  quote: ReturnType<typeof parseFinkazRubQuote>;
  note: Pick<RateAttempt, "code" | "vars"> | null;
}> {
  const res = await fetchImpl(url, {
    headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": UA },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!res.ok) return { quote: null, note: { code: "http", vars: { status: res.status } } };
  const quote = parseFinkazRubQuote(await res.text());
  if (!quote) return { quote: null, note: { code: "noRubRow" } };
  if (quote.sourceUpdatedAt) {
    const ageHours = (now - Date.parse(quote.sourceUpdatedAt)) / 36e5;
    if (Number.isFinite(ageHours) && ageHours > SOURCE_MAX_AGE_HOURS)
      return {
        quote: null,
        note: { code: "sourceStale", vars: { at: quote.sourceUpdatedAt } },
      };
  }
  return { quote, note: null };
}

async function readVtb(
  url: string,
  referer: boolean,
  fetchImpl: Fetch,
): Promise<VtbRateQuote | null> {
  const headers: Record<string, string> = {
    accept: "application/json,text/html,application/xml;q=0.9,*/*;q=0.8",
    "user-agent": UA,
  };
  if (referer && /vtb\.kz/i.test(url))
    headers.referer = "https://online.vtb.kz/unAuth/exchange-rates";
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(FETCH_MS) });
  if (!res.ok) return null;
  return parseVtbRateQuote(await res.text());
}

/** Курс покупки рубля из источника магазина; журнал попытки — в панель. */
export async function fetchRate(
  ctx: TenantContext,
  fetchImpl: Fetch = fetch,
  now = Date.now(),
): Promise<{
  rate: number;
  sell?: number;
  source: string;
  log: string[];
  entries: RateAttempt[];
} | null> {
  const cfg = ctx.tenant.settings.consultant_pricelist;
  const log = attemptLog();
  const at = new Date(now).toISOString();
  if (effectiveRateSource(cfg) !== "vtb") {
    const url = cfg?.rate_url || FINKAZ_KASPI_URL;
    try {
      const { quote, note } = await readFinkaz(url, fetchImpl, now);
      if (quote) {
        log.push({
          src: rateSourceLabel(url),
          code: "ok",
          vars: {
            buy: quote.buy,
            ...(quote.sell ? { sell: quote.sell } : {}),
            ...(quote.sourceUpdatedAt ? { updated: quote.sourceUpdatedAt } : {}),
          },
        });
        await log.save(ctx, at, true);
        return {
          rate: quote.buy,
          sell: quote.sell,
          source: url,
          log: log.lines,
          entries: log.entries,
        };
      }
      if (note) log.push({ src: url, ...note });
    } catch (e) {
      log.push({ src: url, ...errorAttempt(e) });
    }
    await log.save(ctx, at, false);
    return null;
  }
  // ВТБ рвёт соединения из-за рубежа: ретранслятор в Казахстане идёт первым.
  const relay = env().CONSULTANT_VTB_RELAY_URL?.trim();
  const sources: Array<{ url: string; referer: boolean; via?: RateAttempt["via"] }> = [];
  if (relay) sources.push({ url: relay, referer: false, via: "relay" });
  for (const url of [VTB_ONLINE_API_URL, VTB_ONLINE_API_URL.replace(/\/$/, "")]) {
    sources.push({ url, referer: true });
    sources.push({ url, referer: false, via: "noReferer" });
  }
  const started = Date.now();
  for (const s of sources) {
    if (Date.now() - started > TOTAL_BUDGET_MS) {
      log.push({ code: "outOfTime" });
      break;
    }
    const src = { src: s.url, ...(s.via ? { via: s.via } : {}) };
    try {
      const quote = await readVtb(s.url, s.referer, fetchImpl);
      if (quote) {
        log.push({
          ...src,
          code: "ok",
          vars: { buy: quote.buy, ...(quote.sell ? { sell: quote.sell } : {}) },
        });
        await log.save(ctx, at, true);
        return {
          rate: quote.buy,
          sell: quote.sell,
          source: s.url,
          log: log.lines,
          entries: log.entries,
        };
      }
      log.push({ ...src, code: "noRubInResponse" });
    } catch (e) {
      log.push({ ...src, ...errorAttempt(e) });
    }
  }
  await log.save(ctx, at, false);
  return null;
}

export type RefreshResult = {
  ok: boolean;
  stored: StoredVtbRate | null;
  fetched: boolean;
  kind?: RateSourceKind;
  error?: string;
  log?: string[];
};

/** Обновить курс магазина: скачок больше 15% не принимаем, сбой — оставляем прежний. */
export async function refreshRate(
  ctx: TenantContext,
  fetchImpl: Fetch = fetch,
  now = Date.now(),
): Promise<RefreshResult> {
  if (effectiveRateSource(ctx.tenant.settings.consultant_pricelist) === "manual")
    return { ok: true, stored: await getStoredRate(ctx, now), fetched: false, error: "manual" };
  cache.delete(ctx.tenant.id);
  const previous = await getStoredRate(ctx, now);
  const fetched = await fetchRate(ctx, fetchImpl, now);
  if (fetched) {
    const jump = rateJump(previous, fetched.rate, now);
    if (jump) {
      const jumpEntry: RateAttempt = {
        code: "jumpRejected",
        vars: {
          rate: fetched.rate,
          prev: previous?.rate ?? "",
          pct: Math.round(jump * 100),
        },
      };
      const note = attemptText(jumpEntry);
      await saveAttemptLog(ctx, {
        at: new Date(now).toISOString(),
        ok: false,
        attempts: [...fetched.log, note],
        entries: [...fetched.entries, jumpEntry],
      });
      return {
        ok: Boolean(previous),
        stored: previous,
        fetched: false,
        kind: previous ? rateSourceKind(previous.source) : undefined,
        error: "rate_jump_rejected",
        log: [...fetched.log, note],
      };
    }
    const stored = await saveRate(ctx, fetched.rate, fetched.source, fetched.sell, new Date(now));
    return {
      ok: true,
      stored,
      fetched: true,
      kind: rateSourceKind(fetched.source),
      log: fetched.log,
    };
  }
  return {
    ok: Boolean(previous),
    stored: previous,
    fetched: false,
    kind: previous ? rateSourceKind(previous.source) : undefined,
    error: previous ? "fetch_failed_kept_last" : "fetch_failed_no_fallback",
  };
}
