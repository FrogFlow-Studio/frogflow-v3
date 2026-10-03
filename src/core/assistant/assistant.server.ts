import { PREVIEW_AI_OFF, previewReadonly } from "@/lib/preview";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { limitsFor, parseDaily, RESERVE_USD, settleRaw, today } from "@/core/consultant/budget";
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
  cleanSalesText,
  salesPrompt,
  type SalesDigest,
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
  if (previewReadonly()) throw new UserError("err.assist.preview", PREVIEW_AI_OFF);
  if (!req.product.name.trim())
    throw new UserError("err.assist.noName", "Сначала напишите название товара.");
  const { system, user } = assistPrompt(req.task, req.product, req.lang, req.review);
  const raw = await callAssist(ctx, { system, user, maxTokens: 1200 });
  const text = cleanAssistText(req.task, raw);
  if (!text)
    throw new UserError("err.assist.failed", "ИИ-помощник не ответил. Попробуйте ещё раз.");
  return text;
}

/**
 * «Почему изменились продажи»: 3–5 пунктов по сводке двух периодов. Те же
 * пределы и расход, что у черновиков: нет баланса — отказ без вызова модели.
 */
export async function explainSales(
  ctx: TenantContext,
  digest: SalesDigest,
  lang: Locale,
): Promise<string> {
  if (previewReadonly()) throw new UserError("err.assist.preview", PREVIEW_AI_OFF);
  if (!digest.current.orders && !digest.previous.orders)
    throw new UserError("err.assist.salesEmpty", "За оба периода нет продаж — объяснять нечего.");
  const { system, user } = salesPrompt(digest, lang);
  const raw = await callAssist(ctx, { system, user, maxTokens: 900 });
  const text = cleanSalesText(raw);
  if (!text)
    throw new UserError("err.assist.failed", "ИИ-помощник не ответил. Попробуйте ещё раз.");
  return text;
}

/**
 * Один вызов модели с бронью: ключ платформы, пределы в день (черновики и
 * доллары), ИИ-баланс клиента. Сбой модели снимает все брони; ответ меняет
 * бронь на настоящую цену. Возвращает сырой текст ответа.
 */
async function callAssist(
  ctx: TenantContext,
  req: { system: string; user: string; maxTokens: number },
): Promise<string> {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey)
    throw new UserError("err.assist.noKey", "ИИ-помощник недоступен: на платформе не задан ключ.");

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
  if (money !== "written") {
    // Денег не дали — черновик из дневного счёта возвращаем.
    await updateSettingAtomic(ctx, DAILY_KEY, (raw) => {
      const mine = parseAssistDaily(raw, date);
      return mine.count > 0 ? JSON.stringify({ date, count: mine.count - 1 }) : null;
    });
    if (overBudget)
      throw new UserError(
        "err.assist.budget",
        "Дневной предел расходов ИИ исчерпан. Попробуйте завтра.",
      );
    throw busy();
  }

  // ИИ-баланс клиента (core/ai/balance): кончился — черновик и дневной расход назад.
  const { aiReserve, aiSettle, aiRelease } = await import("@/core/ai/balance");
  const hold = await aiReserve(ctx, "assistant", RESERVE_USD);
  if (typeof hold === "string") {
    await updateSettingAtomic(ctx, CONSULTANT_KEYS.daily, (raw) =>
      settleRaw(raw, date, RESERVE_USD, 0),
    );
    await updateSettingAtomic(ctx, DAILY_KEY, (raw) => {
      const mine = parseAssistDaily(raw, date);
      return mine.count > 0 ? JSON.stringify({ date, count: mine.count - 1 }) : null;
    });
    if (hold === "failed") throw busy();
    throw new UserError(
      "err.assist.balance",
      "ИИ-баланс закончился. Пополните его в разделе «ИИ-баланс».",
    );
  }

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: env().CONSULTANT_MODEL?.trim() || DEFAULT_MODEL,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
  } catch (e) {
    await aiRelease(ctx, hold);
    // Модель не ответила — дневная бронь в долларах тоже не нужна.
    await updateSettingAtomic(ctx, CONSULTANT_KEYS.daily, (raw) =>
      settleRaw(raw, date, RESERVE_USD, 0),
    ).catch(() => {});
    const { reportError } = await import("@/lib/errors");
    await reportError(e, { where: "assistant", botId: ctx.tenant.id });
    throw new UserError("err.assist.failed", "ИИ-помощник не ответил. Попробуйте ещё раз.");
  }

  const usd =
    (response.usage.input_tokens * PRICE.in + response.usage.output_tokens * PRICE.out) / 1_000_000;
  await aiSettle(ctx, hold, usd);
  await updateSettingAtomic(ctx, CONSULTANT_KEYS.daily, (raw) =>
    settleRaw(raw, date, RESERVE_USD, usd),
  );

  if (response.stop_reason === "refusal")
    throw new UserError("err.assist.failed", "ИИ-помощник не ответил. Попробуйте ещё раз.");
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** Учёт расхода не записался (сбой базы или сотня параллельных запросов). */
function busy() {
  return new UserError("err.assist.busy", "ИИ-помощник сейчас занят. Попробуйте ещё раз.");
}
