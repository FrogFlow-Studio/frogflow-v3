import type Anthropic from "@anthropic-ai/sdk";
import { serverFailure } from "@/lib/server-failure";
import type { V4Db, V4Result } from "../core/db";
import { botMayReply, openCase } from "../core/cases/cases";
import { createOrder, type Order } from "../core/money/money";
import type { ModelTurn, SellerModel } from "./model";
import { buildSellerPrompt, type Knowledge, parseProfile } from "./prompt";
import { asLang, type BuyerLang, TEXTS } from "./texts";
import { type ReplyAction, type ReplyButton, runTool, SELLER_TOOLS, type ToolRun } from "./tools";

/**
 * Один ответ ИИ-продавца v4 (этап 4а). Порядок:
 *  1. Диалог у продавца (handoff) — бот молчит.
 *  2. Лимит ИИ кончился — простой ответ без модели (поиск товара + кнопки)
 *     и дело продавцу «ИИ-лимит» (решение 44), одно на месяц.
 *  3. Иначе модель с инструментами: до 4 кругов в общем бюджете 35 с,
 *     каждый вызов пишется в расход ИИ (решение 98).
 * Модель не ответила (тайм-аут, ошибка) — тот же простой ответ: это вызов
 * модели, не отправка покупателю, так что дубля сообщения нет.
 */

export type SellerInput = {
  db: V4Db;
  model: SellerModel;
  botId: string;
  buyerId: string;
  /** Прошлые сообщения диалога, старые первыми. Последнее — не входящее. */
  history: Anthropic.MessageParam[];
  text: string;
  /** Общий бюджет ответа, мс. */
  budgetMs?: number;
  now?: Date;
};

export type SellerReply =
  | { kind: "silent"; reason: "handoff" }
  | {
      kind: "reply";
      text: string;
      buttons: Array<ReplyButton & { label: string }>;
      actions: ReplyAction[];
      /** model — ответ модели; fallback — простой ответ без модели. */
      source: "model" | "fallback";
      fallbackReason?: "ai_limit" | "model_failed";
      costMicroUsd: number;
    };

const MAX_ROUNDS = 4;
const DEFAULT_BUDGET_MS = 35_000;

type Context = {
  profile: unknown;
  ai_room_micro_usd: number;
  month: string;
  country: string | null;
  language: string;
  knowledge: Knowledge[];
};

async function sellerContext(db: V4Db, botId: string, buyerId: string, now?: Date) {
  const args: Record<string, unknown> = { p_bot_id: botId, p_buyer_id: buyerId };
  if (now) args.p_now = now.toISOString();
  const r = (await db.call("seller_context", args))[0]?.seller_context as Context | null;
  if (!r) throw serverFailure("v4.seller_context: магазина нет");
  return r;
}

export async function runSeller(input: SellerInput): Promise<SellerReply> {
  const { db, botId, buyerId } = input;
  if (!(await botMayReply(db, botId, buyerId))) return { kind: "silent", reason: "handoff" };

  const ctx = await sellerContext(db, botId, buyerId, input.now);
  const lang = asLang(ctx.language);
  const run: ToolRun = { db, botId, buyerId, country: ctx.country, buttons: [], actions: [] };

  if (Number(ctx.ai_room_micro_usd) <= 0) {
    const r = await openCase(db, {
      botId,
      kind: "ai_limit",
      dedupeKey: `month:${ctx.month}`,
      by: "ai",
      detail: {},
    });
    if (!r.ok) throw serverFailure(`v4.open_case ai_limit: ${r.code}`);
    return fallback(run, input.text, lang, "ai_limit", 0);
  }

  const system = buildSellerPrompt({
    profile: parseProfile(ctx.profile),
    knowledge: ctx.knowledge ?? [],
    country: ctx.country,
    lang,
  });
  const messages: Anthropic.MessageParam[] = [
    ...input.history,
    { role: "user", content: input.text },
  ];
  const signal = AbortSignal.timeout(input.budgetMs ?? DEFAULT_BUDGET_MS);
  let cost = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS;
    let turn: ModelTurn;
    try {
      turn = await input.model.turn({
        system,
        messages,
        tools: last ? [] : SELLER_TOOLS,
        signal,
      });
    } catch {
      return fallback(run, input.text, lang, "model_failed", cost);
    }
    cost += turn.costMicroUsd;
    await recordUsage(db, botId, buyerId, turn, input.now);

    if (turn.toolCalls.length === 0 || last) {
      return {
        kind: "reply",
        text: turn.text,
        buttons: labelled(run.buttons, lang),
        actions: run.actions,
        source: "model",
        costMicroUsd: cost,
      };
    }
    const assistant: Anthropic.ContentBlockParam[] = [];
    if (turn.text) assistant.push({ type: "text", text: turn.text });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of turn.toolCalls) {
      assistant.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      const out = await runTool(run, call.name, call.input);
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "assistant", content: assistant }, { role: "user", content: results });
    // Передал продавцу — дальше не продаём.
    if (run.actions.some((a) => a.kind === "handoff")) {
      // Последний круг — без инструментов, только фраза покупателю.
      const final = await input.model
        .turn({ system, messages, tools: [], signal })
        .catch(() => null);
      if (final) {
        cost += final.costMicroUsd;
        await recordUsage(db, botId, buyerId, final, input.now);
      }
      return {
        kind: "reply",
        text: final?.text || TEXTS.hold[lang],
        buttons: [],
        actions: run.actions,
        source: final ? "model" : "fallback",
        ...(final ? {} : { fallbackReason: "model_failed" as const }),
        costMicroUsd: cost,
      };
    }
  }
  throw serverFailure("v4 seller: круги кончились без ответа");
}

async function recordUsage(db: V4Db, botId: string, buyerId: string, turn: ModelTurn, now?: Date) {
  const args: Record<string, unknown> = {
    p_bot_id: botId,
    p_purpose: "seller",
    p_model: turn.model,
    p_input: turn.inputTokens,
    p_output: turn.outputTokens,
    p_cost_micro_usd: turn.costMicroUsd,
    p_buyer_id: buyerId,
  };
  if (now) args.p_now = now.toISOString();
  await db.call("record_ai_usage", args);
}

const labelled = (buttons: ReplyButton[], lang: BuyerLang) =>
  buttons.map((b) => ({ ...b, label: `${TEXTS.buy[lang]}: ${b.title}` }));

/** Простой ответ без модели: товары по словам покупателя с кнопками, иначе «продавец ответит». */
async function fallback(
  run: ToolRun,
  text: string,
  lang: BuyerLang,
  reason: "ai_limit" | "model_failed",
  cost: number,
): Promise<SellerReply> {
  run.buttons.length = 0;
  const found = (await runTool(run, "find_products", { query: text })) as {
    items: Array<{ product_id: string; has_variants: boolean }>;
  };
  // Без слов поиск отдаёт весь каталог — это не «нашлось».
  const hasWords = /[\p{L}\p{N}]{2,}/u.test(text);
  if (hasWords) {
    for (const item of found.items.filter((i) => !i.has_variants).slice(0, 3)) {
      await runTool(run, "offer_card", { product_id: item.product_id });
    }
  }
  return {
    kind: "reply",
    text: run.buttons.length > 0 ? TEXTS.found[lang] : TEXTS.hold[lang],
    buttons: labelled(run.buttons, lang),
    actions: run.actions,
    source: "fallback",
    fallbackReason: reason,
    costMicroUsd: cost,
  };
}

/** Нажатие «Купить» (решение 8): заказ на один товар в валюте страны покупателя. */
export async function buyNow(
  db: V4Db,
  input: { botId: string; buyerId: string; productId: string; country: string | null },
): Promise<V4Result<Order>> {
  return createOrder(db, {
    botId: input.botId,
    buyerId: input.buyerId,
    country: input.country,
    productIds: [input.productId],
    by: "buyer",
  });
}
