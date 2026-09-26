import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { limitsFor, parseDaily, RESERVE_USD, settleDaily, today } from "@/core/consultant/budget";
import { KEYS as CONSULTANT_KEYS } from "@/core/consultant/engine.server";
import { UserError } from "@/core/i18n/user-error";
import type { Locale } from "@/core/i18n/locale";
import { updateSettingAtomic } from "@/core/settings/settings";
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
 * черновиков в день. До вызова модели черновик и деньги бронируются
 * атомарной записью (updateSettingAtomic): сотня параллельных запросов не
 * проскочит мимо пределов. После ответа бронь меняется на настоящую цену.
 */
export async function assistText(ctx: TenantContext, req: AssistRequest): Promise<string> {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey)
    throw new UserError("err.assist.noKey", "ИИ-помощник недоступен: на платформе не задан ключ.");
  if (!req.product.name.trim())
    throw new UserError("err.assist.noName", "Сначала напишите название товара.");

  const date = today();
  let overLimit = false;
  const slot = await updateSettingAtomic(ctx, DAILY_KEY, (raw) => {
    const mine = parseAssistDaily(raw, date);
    if (mine.count >= ASSIST_DAILY_LIMIT) {
      overLimit = true;
      return null;
    }
    return JSON.stringify({ date, count: mine.count + 1 });
  });
  if (overLimit)
    throw new UserError(
      "err.assist.limit",
      "На сегодня черновики закончились ({limit} в день). Попробуйте завтра.",
      { limit: ASSIST_DAILY_LIMIT },
    );
  if (slot !== "written") throw busy();
  const usdCap = limitsFor(ctx.tenant.settings.consultant_limits).dailyUsd;
  let overBudget = false;
  const money = await updateSettingAtomic(ctx, CONSULTANT_KEYS.daily, (raw) => {
    const shared = parseDaily(raw, date);
    if (shared.usd >= usdCap) {
      overBudget = true;
      return null;
    }
    return JSON.stringify({
      ...shared,
      usd: Math.round((shared.usd + RESERVE_USD) * 1_000_000) / 1_000_000,
    });
  });
  if (overBudget)
    throw new UserError(
      "err.assist.budget",
      "Дневной предел расходов ИИ исчерпан. Попробуйте завтра.",
    );
  if (money !== "written") throw busy();

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
  await updateSettingAtomic(ctx, CONSULTANT_KEYS.daily, (raw) =>
    JSON.stringify(settleDaily(parseDaily(raw, date), RESERVE_USD, usd)),
  );

  if (response.stop_reason === "refusal")
    throw new UserError("err.assist.failed", "ИИ-помощник не ответил. Попробуйте ещё раз.");
  const raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const text = cleanAssistText(req.task, raw);
  if (!text)
    throw new UserError("err.assist.failed", "ИИ-помощник не ответил. Попробуйте ещё раз.");
  return text;
}

/** Учёт расхода не записался (сбой базы или сотня параллельных запросов). */
function busy() {
  return new UserError("err.assist.busy", "ИИ-помощник сейчас занят. Попробуйте ещё раз.");
}
