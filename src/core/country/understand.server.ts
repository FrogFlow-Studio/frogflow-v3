/**
 * Страна из слов покупателя — вызов модели (правила и тексты — understand.ts).
 * Ключ платформы, как у ИИ после оплаты: доли цента на сообщение, потолок в
 * день на клиента. Модели нет, потолок исчерпан, сбой — запасной разбор по
 * названиям (fallbackCountry): покупатель не должен остаться без ответа.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { modelParams } from "@/core/ai/pure";
import { getSetting, updateSettingAtomic } from "@/core/settings/settings";
import { todayInZone } from "@/core/preorder/preorder";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { previewReadonly } from "@/lib/preview";
import { serverFailure } from "@/lib/server-failure";
import {
  COUNTRY_AI_CAP_KEY,
  COUNTRY_AI_ENABLED_KEY,
  COUNTRY_AI_MAX_TEXT,
  COUNTRY_AI_MODEL,
  COUNTRY_AI_TIMEOUT_MS,
  COUNTRY_SYSTEM,
  countryAiSpendKey,
  countryCostUsd,
  countryTool,
  countryUserPrompt,
  fallbackCountry,
  parseCountryCap,
  parseCountryReading,
  type CountryChoice,
  type CountryReading,
} from "./understand";

export type CallCountryModel = (
  system: string,
  user: string,
  tool: ReturnType<typeof countryTool>,
) => Promise<{ input: unknown; usage?: { input_tokens?: number; output_tokens?: number } }>;

const liveModel: CallCountryModel = async (system, user, tool) => {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw serverFailure("ИИ-ключ платформы не задан");
  const res = await new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: COUNTRY_AI_TIMEOUT_MS,
  }).messages.create({
    model: COUNTRY_AI_MODEL,
    max_tokens: 100,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: user }],
    ...modelParams(COUNTRY_AI_MODEL),
  } as never);
  const r = res as unknown as {
    content: Array<{ type: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const block = r.content.find((b) => b.type === "tool_use" && b.name === tool.name);
  return { input: block?.input ?? null, usage: r.usage };
};

let modelOverride: CallCountryModel | null = null;
/** Тесты: подставить ответ модели. */
export function setCountryModelForTests(fn: CallCountryModel | null) {
  modelOverride = fn;
}

function spentField(raw: string | null | undefined, field: "usd" | "calls"): number {
  try {
    return Number((JSON.parse(raw ?? "") as Record<string, unknown>)[field]) || 0;
  } catch {
    return 0;
  }
}
const spentUsd = (raw: string | null | undefined) => spentField(raw, "usd");
const spentCalls = (raw: string | null | undefined) => spentField(raw, "calls");

/** Модель доступна: ключ есть, не предпросмотр (тесты подставляют модель сами). */
function modelReady(): boolean {
  if (modelOverride) return true;
  try {
    if (previewReadonly()) return false;
    return Boolean(env().ANTHROPIC_API_KEY?.trim());
  } catch {
    // Окружение не настроено — модели нет, работает запасной разбор.
    return false;
  }
}

/**
 * Из какой страны покупатель по его сообщению. Список — страны оплаты
 * клиента; ответ модели вне списка не принимается.
 */
export async function understandCountry(
  ctx: TenantContext,
  p: { text: string; options: readonly CountryChoice[]; asked: boolean; now?: number },
): Promise<CountryReading> {
  const text = p.text.trim();
  const none: CountryReading = { code: null, onlyCountry: false };
  if (!text || !p.options.length) return none;
  if (text.length > COUNTRY_AI_MAX_TEXT) return fallbackCountry(text, p.options);
  if (!modelReady()) return fallbackCountry(text, p.options);
  if ((await getSetting(ctx, COUNTRY_AI_ENABLED_KEY))?.trim() === "off")
    return fallbackCountry(text, p.options);
  const date = todayInZone(ctx.timezone, new Date(p.now ?? Date.now()));
  const key = countryAiSpendKey(date);
  const cap = parseCountryCap(await getSetting(ctx, COUNTRY_AI_CAP_KEY));
  if (spentUsd(await getSetting(ctx, key)) >= cap) return fallbackCountry(text, p.options);
  const tool = countryTool(p.options);
  let answer: Awaited<ReturnType<CallCountryModel>>;
  try {
    answer = await (modelOverride ?? liveModel)(
      COUNTRY_SYSTEM,
      countryUserPrompt({ text, options: p.options, asked: p.asked }),
      tool,
    );
  } catch (e) {
    console.warn(`[country:${ctx.tenant.id}] модель: ${String(e)}`);
    return fallbackCountry(text, p.options);
  }
  const usd = countryCostUsd(answer.usage);
  await updateSettingAtomic(ctx, key, (raw) =>
    JSON.stringify({
      usd: Math.round((spentUsd(raw) + usd) * 1e6) / 1e6,
      calls: spentCalls(raw) + 1,
    }),
  ).catch((e: unknown) => console.warn(`[country:${ctx.tenant.id}] расход: ${String(e)}`));
  return parseCountryReading(answer.input, p.options);
}
