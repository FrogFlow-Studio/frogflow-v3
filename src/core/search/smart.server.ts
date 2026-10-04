import { serverFailure } from "@/lib/server-failure";
import { previewReadonly } from "@/lib/preview";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { getSetting, getSettings, trySetSetting } from "@/core/settings/settings";
import {
  COOLDOWN_SECONDS,
  DAILY_LIMIT,
  MAX_CANDIDATES,
  MAX_QUERY_LEN,
  SMART_SEARCH_MODEL,
  addSpend,
  buildPrompt,
  estimateUsd,
  formatDailyCount,
  parseDailyCount,
  parseSmartSearchIds,
  parseSpend,
  smartSearchUsdLimit,
  spendExhausted,
  todayUtc,
  type Candidate,
} from "./smart-pure";

/**
 * Умный поиск — фолбэк, когда обычный поиск ничего не нашёл. У каждого вызова
 * реальная стоимость (Anthropic API), поэтому: отдельный переключатель
 * продавца (smart_search_enabled), личный кулдаун покупателя, дневной
 * потолок запросов и дневной предел расходов в долларах на бота. Модель — Haiku 4.5, как в v1: счёт выставляется клиенту.
 */
export const KEYS = {
  enabled: "smart_search_enabled",
  dailyCount: "smart_search_daily_count",
  dailySpend: "smart_search_daily_spend",
  lifetimeSpend: "smart_search_lifetime_spend",
  lastError: "smart_search_last_error",
} as const;

const TIMEOUT_MS = 40_000;
/** Бронь ИИ-баланса на вызов: до 12 000 токенов ответа и сотни кандидатов в запросе. */
const SMART_SEARCH_RESERVE_USD = 0.08;

export function platformHasKey(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY?.trim());
}

export async function smartSearchEnabled(ctx: TenantContext): Promise<boolean> {
  if (!platformHasKey() || !ctx.tenant.modules.smart_search) return false;
  return (await getSetting(ctx, KEYS.enabled)) === "true";
}

/**
 * Предохранители бота, общие для всех каналов (бот, Instagram/WhatsApp, сайт):
 * дневной предел расходов в долларах и дневной счётчик запросов. Личный кулдаун
 * у каждого канала свой (consumeQuota, consumeWebQuota); эти два числа — на весь
 * магазин, поэтому сайт не может потратить больше, чем бот.
 */
async function consumeShopQuota(ctx: TenantContext): Promise<boolean> {
  const s = await getSettings(ctx, [KEYS.dailyCount, KEYS.dailySpend, KEYS.lastError]);
  const usdLimit = smartSearchUsdLimit(ctx.tenant.settings.smart_search_limits);
  if (spendExhausted(s[KEYS.dailySpend], todayUtc(), usdLimit)) {
    // Продавец видит причину рядом с переключателем; пишем раз в день.
    const today = todayUtc();
    if (!s[KEYS.lastError]?.startsWith(today))
      await trySetSetting(
        ctx,
        KEYS.lastError,
        `${new Date().toISOString()} — дневной предел расходов ($${usdLimit}) исчерпан, до полуночи UTC умный поиск выключен`,
      );
    return false;
  }
  const count = parseDailyCount(s[KEYS.dailyCount]);
  if (count >= DAILY_LIMIT) return false;
  await trySetSetting(ctx, KEYS.dailyCount, formatDailyCount(count + 1));
  return true;
}

/**
 * Все предохранители разом: кулдаун покупателя (метка в bot_users.state),
 * дневной счётчик и дневной расход бота. Если хоть один не пройден — вызова
 * модели не будет.
 */
export async function consumeQuota(ctx: TenantContext, customer: Customer): Promise<boolean> {
  const now = Date.now();
  const last = customer.state.last_smart_search_at;
  if (typeof last === "string" && now - new Date(last).getTime() < COOLDOWN_SECONDS * 1000)
    return false;
  const mark = await ctx.db
    .from("bot_users")
    .update({ state: { ...customer.state, last_smart_search_at: new Date(now).toISOString() } })
    .eq("user_key", customer.userKey);
  // Метку кулдауна не записали — вызова модели нет (предохранитель расхода не обходится).
  if (mark.error) {
    console.error(`[smart-search] кулдаун ${customer.userKey}: ${mark.error.message}`);
    return false;
  }
  return consumeShopQuota(ctx);
}

/** Сколько умных поисков с одного адреса за десять минут: сессию в браузере можно сменить, адрес сложнее. */
export const WEB_IP_BUDGET = { limit: 6, windowMs: 600_000 } as const;

/**
 * Предохранители для покупателя сайта: у него нет строки bot_users, поэтому
 * кулдаун (те же 45 с) считается по сессии браузера, а сверху — потолок на адрес.
 * Дальше те же общие дневной счётчик и расход бота. Кулдаун записывается ДО вызова
 * модели и после сбоя не возвращается: платный вызов не повторяется вслепую.
 */
export async function consumeWebQuota(
  ctx: TenantContext,
  session: string,
  ip: string | null,
): Promise<boolean> {
  const { takeShared } = await import("@/core/storefront/rate-limit");
  if (
    !(await takeShared(ctx, "smart_web", session, {
      limit: 1,
      windowMs: COOLDOWN_SECONDS * 1000,
    }))
  )
    return false;
  if (ip && !(await takeShared(ctx, "smart_web_ip", ip, WEB_IP_BUDGET))) return false;
  return consumeShopQuota(ctx);
}

async function recordSpend(
  ctx: TenantContext,
  usage: { inputTokens: number; outputTokens: number },
) {
  const s = await getSettings(ctx, [KEYS.dailySpend, KEYS.lifetimeSpend]);
  const today = todayUtc();
  const dailyRaw = s[KEYS.dailySpend];
  const daily = dailyRaw?.includes(`"date":"${today}"`) ? parseSpend(dailyRaw) : parseSpend(null);
  await trySetSetting(
    ctx,
    KEYS.dailySpend,
    JSON.stringify({ ...addSpend(daily, usage), date: today }),
  );
  await trySetSetting(
    ctx,
    KEYS.lifetimeSpend,
    JSON.stringify(addSpend(parseSpend(s[KEYS.lifetimeSpend]), usage)),
  );
}

async function candidates(ctx: TenantContext): Promise<Candidate[]> {
  const { data, error: dataError } = await ctx.db
    .from("products")
    .select("id, name, description, keywords")
    .eq("is_active", true)
    .order("sort_order")
    .limit(MAX_CANDIDATES);
  if (dataError) throw serverFailure(`Поиск: ${dataError.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: (p.description ?? "").slice(0, 300),
    keywords: (p.keywords ?? "").slice(0, 100),
  }));
}

/**
 * id подходящих товаров по убыванию релевантности, или null при сбое (нет
 * ключа, сеть, невалидный ответ) — вызывающий код покажет «ничего не
 * найдено». Последняя причина сбоя пишется в настройки, чтобы продавец видел
 * её рядом с переключателем, а не только в логе.
 */
export async function smartSearchProductIds(
  ctx: TenantContext,
  query: string,
): Promise<string[] | null> {
  if (previewReadonly()) return null;
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const q = query.trim().slice(0, MAX_QUERY_LEN);
  const list = await candidates(ctx);
  if (!q || list.length === 0) return null;

  // ИИ-баланс клиента (core/ai/balance): кончился — обычный поиск без ИИ.
  const { aiReserve, aiSettle, aiRelease } = await import("@/core/ai/balance");
  const hold = await aiReserve(ctx, "smart_search", SMART_SEARCH_RESERVE_USD);
  if (typeof hold === "string") {
    await trySetSetting(
      ctx,
      KEYS.lastError,
      hold === "short"
        ? `${new Date().toISOString()} — ИИ-баланс закончился, умный поиск ждёт пополнения`
        : `${new Date().toISOString()} — сбой учёта ИИ-баланса, этот поиск без ИИ`,
    );
    return null;
  }
  let settled = false;
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
  try {
    const response = await client.messages.create({
      model: SMART_SEARCH_MODEL,
      // 600 кандидатов полными UUID — с запасом, чтобы модель не обрезала JSON.
      max_tokens: 12_000,
      messages: [{ role: "user", content: buildPrompt(ctx.tenant.vertical, q, list) }],
    });
    await aiSettle(
      ctx,
      hold,
      estimateUsd({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      }),
    );
    settled = true;
    await recordSpend(ctx, {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const ids = parseSmartSearchIds(
      text,
      list.map((c) => c.id),
    );
    await trySetSetting(ctx, KEYS.lastError, "");
    return ids;
  } catch (e) {
    if (!settled) await aiRelease(ctx, hold);
    const detail =
      e instanceof Anthropic.APIError
        ? `HTTP ${e.status ?? "?"}: ${e.message}`
        : e instanceof Error
          ? `${e.name}: ${e.message}`
          : String(e);
    console.error(`[smart-search:${ctx.tenant.id}]`, detail);
    await trySetSetting(
      ctx,
      KEYS.lastError,
      `${new Date().toISOString()} — ${detail}`.slice(0, 500),
    );
    return null;
  }
}
