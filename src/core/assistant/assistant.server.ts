import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { limitsFor, parseDaily, today } from "@/core/consultant/budget";
import { KEYS as CONSULTANT_KEYS } from "@/core/consultant/engine.server";
import { UserError } from "@/core/i18n/user-error";
import type { Locale } from "@/core/i18n/locale";
import { getSettings, trySetSetting } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  ASSIST_DAILY_LIMIT,
  assistPrompt,
  cleanAssistText,
  parseAssistDaily,
  type AssistProduct,
  type AssistReview,
  type AssistTask,
} from "./prompts";

/** Модель та же, что у консультанта: платформа уже выбрала её по цене (CONSULTANT_MODEL). */
const DEFAULT_MODEL = "claude-haiku-4-5";
/** Цена Haiku 4.5, $ за миллион токенов — как в core/consultant. */
const PRICE = { in: 1, out: 5 };
const TIMEOUT_MS = 40_000;
const DAILY_KEY = "seller_assist_daily";

export type AssistRequest = {
  task: AssistTask;
  product: AssistProduct;
  lang: Locale;
  /** Для task "review": отзыв, на который отвечает продавец. */
  review?: AssistReview;
};

/**
 * Черновик текста для продавца. Расход идёт в тот же дневной предел в
 * долларах, что у ИИ-консультанта (core/consultant/budget), и в свой счётчик
 * черновиков в день. Проверки до вызова модели; как и у консультанта, они не
 * атомарны — это мягкий потолок.
 */
export async function assistText(ctx: TenantContext, req: AssistRequest): Promise<string> {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey)
    throw new UserError("err.assist.noKey", "ИИ-помощник недоступен: на платформе не задан ключ.");
  if (!req.product.name.trim())
    throw new UserError("err.assist.noName", "Сначала напишите название товара.");

  const date = today();
  const s = await getSettings(ctx, [DAILY_KEY, CONSULTANT_KEYS.daily]);
  const mine = parseAssistDaily(s[DAILY_KEY], date);
  if (mine.count >= ASSIST_DAILY_LIMIT)
    throw new UserError(
      "err.assist.limit",
      "На сегодня черновики закончились ({limit} в день). Попробуйте завтра.",
      { limit: ASSIST_DAILY_LIMIT },
    );
  const shared = parseDaily(s[CONSULTANT_KEYS.daily], date);
  const usdCap = limitsFor(ctx.tenant.settings.consultant_limits).dailyUsd;
  if (shared.usd >= usdCap)
    throw new UserError(
      "err.assist.budget",
      "Дневной предел расходов ИИ исчерпан. Попробуйте завтра.",
    );

  const { system, user } = assistPrompt(req.task, req.product, req.lang, req.review);
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: env().CONSULTANT_MODEL?.trim() || DEFAULT_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    const { reportError } = await import("@/lib/errors");
    await reportError(e, { where: "assistant", botId: ctx.tenant.id });
    throw new UserError("err.assist.failed", "ИИ-помощник не ответил. Попробуйте ещё раз.");
  }

  const usd =
    (response.usage.input_tokens * PRICE.in + response.usage.output_tokens * PRICE.out) / 1_000_000;
  await trySetSetting(ctx, DAILY_KEY, JSON.stringify({ date, count: mine.count + 1 }));
  await trySetSetting(
    ctx,
    CONSULTANT_KEYS.daily,
    JSON.stringify({ ...shared, usd: Math.round((shared.usd + usd) * 1_000_000) / 1_000_000 }),
  );

  if (response.stop_reason === "refusal")
    throw new UserError("err.assist.failed", "ИИ-помощник не ответил. Попробуйте ещё раз.");
  const raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const text = cleanAssistText(req.task, raw);
  if (!text)
    throw new UserError("err.assist.failed", "ИИ-помощник не ответил. Попробуйте ещё раз.");
  return text;
}
