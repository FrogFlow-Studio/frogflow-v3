import type { TenantContext } from "@/core/tenant/resolve.server";
import { env } from "@/config/env";
import { getSetting, setSetting } from "@/core/settings/settings";
import { bankNameFromFinkazUrl, parseFinkazRubQuote } from "./finkaz-parse";
import { isRateFresh, parseStoredRate, type StoredVtbRate } from "./rate";
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

export type VtbAttemptLog = { at: string; ok: boolean; attempts: string[] };
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
  const hit = cache.get(ctx.tenant.id);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", VTB_RATE_KEY)
    .maybeSingle();
  if (error) {
    console.warn(`[rate:${ctx.tenant.id}] курс не прочитан: ${error.message}`);
    return hit?.value ?? null;
  }
  const raw = (data as { value?: string | null } | null)?.value ?? null;
  const value = parseStoredRate(raw);
  if (raw?.trim() && !value) return hit?.value ?? null; // испорчено — не «нет курса»
  cache.set(ctx.tenant.id, { at: now, value });
  return value;
}

/** Курс для цены покупателю; протухший не отдаём — рубли подтвердит менеджер. */
export async function getFreshRate(
  ctx: TenantContext,
  now = Date.now(),
): Promise<StoredVtbRate | null> {
  const stored = await getStoredRate(ctx, now);
  return isRateFresh(stored, now) ? stored : null;
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
  const raw = err instanceof Error ? err.message : String(err);
  if (/timeout|timed out|aborted/i.test(raw)) return "не ответил за 6 секунд (таймаут)";
  if (/fetch failed|ECONNRESET|reset|EAI_AGAIN|ENOTFOUND|socket/i.test(raw))
    return `соединение не установлено (${raw})`;
  return raw;
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

async function readFinkaz(url: string, fetchImpl: Fetch, now: number) {
  const res = await fetchImpl(url, {
    headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": UA },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!res.ok) return { quote: null, note: `ответ ${res.status}` };
  const quote = parseFinkazRubQuote(await res.text());
  if (!quote) return { quote: null, note: "страница открылась, но строки RUB / KZT в ней нет" };
  if (quote.sourceUpdatedAt) {
    const ageHours = (now - Date.parse(quote.sourceUpdatedAt)) / 36e5;
    if (Number.isFinite(ageHours) && ageHours > SOURCE_MAX_AGE_HOURS)
      return { quote: null, note: `курс на сайте от ${quote.sourceUpdatedAt}, старше суток` };
  }
  return { quote, note: "" };
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
): Promise<{ rate: number; sell?: number; source: string; log: string[] } | null> {
  const cfg = ctx.tenant.settings.consultant_pricelist;
  const log: string[] = [];
  const at = new Date(now).toISOString();
  if (cfg?.rate_source !== "vtb") {
    const url = cfg?.rate_url || FINKAZ_KASPI_URL;
    try {
      const { quote, note } = await readFinkaz(url, fetchImpl, now);
      if (quote) {
        log.push(
          `${rateSourceLabel(url)}: OK (покупка ${quote.buy}${quote.sell ? `, продажа ${quote.sell}` : ""}${
            quote.sourceUpdatedAt ? `, обновлено ${quote.sourceUpdatedAt}` : ""
          })`,
        );
        await saveAttemptLog(ctx, { at, ok: true, attempts: log });
        return { rate: quote.buy, sell: quote.sell, source: url, log };
      }
      log.push(`${url}: ${note}`);
    } catch (e) {
      log.push(`${url}: ${errorText(e)}`);
    }
    await saveAttemptLog(ctx, { at, ok: false, attempts: log });
    return null;
  }
  // ВТБ рвёт соединения из-за рубежа: ретранслятор в Казахстане идёт первым.
  const relay = env().CONSULTANT_VTB_RELAY_URL?.trim();
  const sources: Array<{ url: string; referer: boolean; label: string }> = [];
  if (relay) sources.push({ url: relay, referer: false, label: `ретранслятор ${relay}` });
  for (const url of [VTB_ONLINE_API_URL, VTB_ONLINE_API_URL.replace(/\/$/, "")]) {
    sources.push({ url, referer: true, label: url });
    sources.push({ url, referer: false, label: `${url} (без referer)` });
  }
  const started = Date.now();
  for (const s of sources) {
    if (Date.now() - started > TOTAL_BUDGET_MS) {
      log.push("дальше не пробовали: вышло время на обход источников");
      break;
    }
    try {
      const quote = await readVtb(s.url, s.referer, fetchImpl);
      if (quote) {
        log.push(
          `${s.label}: OK (покупка ${quote.buy}${quote.sell ? `, продажа ${quote.sell}` : ""})`,
        );
        await saveAttemptLog(ctx, { at, ok: true, attempts: log });
        return { rate: quote.buy, sell: quote.sell, source: s.url, log };
      }
      log.push(`${s.label}: ответ получен, но курса рубля в нём нет`);
    } catch (e) {
      log.push(`${s.label}: ${errorText(e)}`);
    }
  }
  await saveAttemptLog(ctx, { at, ok: false, attempts: log });
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
  if (ctx.tenant.settings.consultant_pricelist?.rate_source === "manual")
    return { ok: true, stored: await getStoredRate(ctx, now), fetched: false, error: "manual" };
  cache.delete(ctx.tenant.id);
  const previous = await getStoredRate(ctx, now);
  const fetched = await fetchRate(ctx, fetchImpl, now);
  if (fetched) {
    const jump = rateJump(previous, fetched.rate, now);
    if (jump) {
      const note = `курс ${fetched.rate} отличается от прошлого ${previous?.rate} на ${Math.round(
        jump * 100,
      )}% — не приняли, оставили прежний`;
      await saveAttemptLog(ctx, {
        at: new Date(now).toISOString(),
        ok: false,
        attempts: [...fetched.log, note],
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
