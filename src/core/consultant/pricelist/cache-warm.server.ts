import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { modelParams } from "@/core/ai/pure";
import { todayInZone } from "@/core/preorder/preorder";
import { updateSettingAtomic, updateSettingStamped } from "@/core/settings/settings";
import { servedByV2 } from "@/core/tenant/directory";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { previewReadonly } from "@/lib/preview";
import { serverFailure } from "@/lib/server-failure";
import { parseSpend } from "@/core/postpay/postpay";
import { pricelistMode } from "./mode";

/**
 * Прогрев кеша консультанта по прайсу (BOVI). Начало каждого запроса —
 * инструменты и подсказка с картой прайса (≈12 тыс. токенов) — лежит в кеше
 * Anthropic час. После часа тишины первый ответ пишет его заново по 4 $ за
 * миллион (≈0,048 $), а чтение из кеша стоит ≈0,0024 $. Короткий вызов с тем
 * же началом, пока кеш не остыл, продлевает его ещё на час.
 *
 * Галочка оператора `consultant_cache_warm`, по умолчанию выключено. Вызов не
 * создаёт диалога и не списывается с ИИ-баланса клиента: платит платформа,
 * расход — отдельно в `consultant_cache_warm_spend:<дата>`.
 */

/** Кеш живёт час; крон опроса ящика идёт раз в минуту — греем после 54 минут тишины. */
export const CACHE_WARM_IDLE_MS = 54 * 60_000;
/** Последний прогрев магазина: условная отметка, только выигравший шлёт вызов. */
export const CACHE_WARM_KEY = "consultant_cache_warm";
export const cacheWarmSpendKey = (date: string) => `consultant_cache_warm_spend:${date}`;
const WARM_TIMEOUT_MS = 20_000;

export type CacheWarmResult = { warmed: true; usd: number; idleMin: number } | { skipped: string };

type WarmCall = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Pick<Anthropic.Message, "usage">>;

const liveCall: WarmCall = async (params) => {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw serverFailure("ИИ-ключ платформы не задан");
  // Без повторов: вызов, который мог дойти, не дублируем.
  return new Anthropic({ apiKey, maxRetries: 0, timeout: WARM_TIMEOUT_MS }).messages.create(
    params,
    { signal: AbortSignal.timeout(WARM_TIMEOUT_MS) },
  );
};

/** Пора ли греть: с последнего вызова модели (ответ или прогрев) прошло не меньше `CACHE_WARM_IDLE_MS`. */
export function cacheWarmDue(now: number, lastTouch: number | null): boolean {
  return lastTouch === null || now - lastTouch >= CACHE_WARM_IDLE_MS;
}

function lastWarmAt(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const at = Date.parse((JSON.parse(raw) as { at?: string }).at ?? "");
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Последний ответ консультанта, на который ушёл вызов модели. */
async function lastModelRunAt(ctx: TenantContext): Promise<number | null> {
  const { data, error } = await ctx.db
    .from("consultant_message_runs")
    .select("created_at")
    .eq("bot_id", ctx.tenant.id)
    .not("model", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw serverFailure(`[cache-warm] последний ответ консультанта: ${error.message}`);
  const at = data?.[0]?.created_at ? Date.parse(data[0].created_at) : NaN;
  return Number.isFinite(at) ? at : null;
}

export async function warmPricelistCache(
  ctx: TenantContext,
  deps: { call?: WarmCall; now?: Date } = {},
): Promise<CacheWarmResult> {
  if (!servedByV2(ctx.tenant)) return { skipped: "клиент не на v2" };
  if (ctx.tenant.settings.consultant_cache_warm !== true) return { skipped: "off" };
  if (!pricelistMode(ctx.tenant)) return { skipped: "не консультант по прайсу" };
  if (previewReadonly()) return { skipped: "preview" };
  const { consultantEnabled, callUsd, DEFAULT_MODEL } = await import("../engine.server");
  if (!(await consultantEnabled(ctx))) return { skipped: "консультант выключен" };
  // Ответов не будет — греть нечего.
  const { aiBalancePeek } = await import("@/core/ai/balance");
  if ((await aiBalancePeek(ctx))?.empty) return { skipped: "ИИ-баланс клиента пуст" };

  const now = (deps.now ?? new Date()).getTime();
  const lastRun = await lastModelRunAt(ctx);
  if (!cacheWarmDue(now, lastRun)) return { skipped: "кеш тёплый: недавно отвечал" };
  // Отметка — условной записью до вызова: два крона одновременно греют один раз.
  let idleFrom: number | null = null;
  const claim = await updateSettingStamped(ctx, CACHE_WARM_KEY, (raw) => {
    const lastWarm = lastWarmAt(raw);
    const touch = Math.max(lastRun ?? 0, lastWarm ?? 0) || null;
    if (!cacheWarmDue(now, touch)) return null;
    idleFrom = touch;
    return JSON.stringify({ at: new Date(now).toISOString() });
  });
  if (claim === "skipped") return { skipped: "кеш тёплый: недавно грели" };
  if (claim === "failed") throw serverFailure("[cache-warm] отметка прогрева не записана");

  const { loadPricelistData, pricelistModel, pricelistPromptPrefix } =
    await import("./engine.server");
  const data = await loadPricelistData(ctx);
  if (!data.catalog.length) return { skipped: "прайс пуст" };
  const model = await pricelistModel(ctx, env().CONSULTANT_MODEL?.trim() || DEFAULT_MODEL);
  const { system, tools } = pricelistPromptPrefix(data);
  const res = await (deps.call ?? liveCall)({
    model,
    max_tokens: 1,
    system,
    tools,
    messages: [{ role: "user", content: "." }],
    ...modelParams(model),
  } as Anthropic.MessageCreateParamsNonStreaming);
  const usd = callUsd(model, res.usage);
  const date = todayInZone(ctx.timezone, new Date(now));
  await updateSettingAtomic(ctx, cacheWarmSpendKey(date), (raw) => {
    const s = parseSpend(raw);
    return JSON.stringify({ usd: Math.round((s.usd + usd) * 1e6) / 1e6, calls: s.calls + 1 });
  }).catch((e: unknown) => console.warn(`[cache-warm:${ctx.tenant.id}] расход: ${String(e)}`));
  return {
    warmed: true,
    usd,
    idleMin: idleFrom === null ? -1 : Math.round((now - idleFrom) / 60_000),
  };
}
