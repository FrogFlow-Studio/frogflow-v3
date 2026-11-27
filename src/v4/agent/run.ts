import type Anthropic from "@anthropic-ai/sdk";
import { serverFailure } from "@/lib/server-failure";
import type { V4Db } from "../core/db";
import { type CheckContext, type CheckLang, checkReply } from "./checks";
import {
  type AgentMode,
  conversationHistory,
  countAiReply,
  type DoneAction,
  type FallbackReason,
  type HistoryMessage,
  maskContacts,
  type MessageChannel,
  recordIncoming,
  recordReply,
  releaseTurn,
  type ShownButton,
  takeTurn,
} from "./conversation";
import {
  type AgentModel,
  type AgentRequest,
  type AgentTurn,
  isModelBusy,
  type SystemBlock,
} from "./model";
import { aiHold, aiRelease, aiSettle, withMarkup } from "./wallet";

/**
 * Ядро ИИ-сотрудника v4 (этап 1 «Мозг магазина»; проект, раздел 12.2). Ядро не
 * знает слов «товар» и «заказ» — это знает роль (`AgentRole`): промпт,
 * инструменты, простой ответ без ИИ, данные для проверки. Порядок одного ответа:
 *
 *  1. Записать входящее; повтор вебхука — молчим (duplicate).
 *  2. Покупатель заблокирован — молчим; диалог у продавца — молчим.
 *  3. ИИ у магазина выключен — молчим (ai_off): канал ведёт себя как v3.
 *  4. Взять ход; занят — молчим (queued): держатель хода ответит за оба сообщения.
 *  5. Предел ответов ИИ покупателю в день → простой ответ без ИИ.
 *  6. Бронь в кошельке (не в тени) → не хватило или дневной предел → простой ответ.
 *  7. Модель до 4 кругов; текст всех кругов собирается (ошибка 1 от 05.11);
 *     последний круг и круг после передачи продавцу — tool_choice none (ошибка 3).
 *     429/529 — один повтор в пределах бюджета.
 *  8. Проверка ответа; не прошла — одна попытка исправить с замечанием, потом
 *     простой ответ и передача продавцу (check_failed).
 *  9. Расчёт брони по факту с наценкой; ответ в журнал с кнопками; отпустить ход.
 *     Пришли новые сообщения за время хода — ещё один ответ, за них.
 *
 * Режимы: live — настоящий ответ; shadow — тень (за счёт платформы, без брони и
 * без памяти); test — окно проверки продавца и экзамен (с баланса, пометка «тест»).
 */

export type TurnArgs = {
  botId: string;
  buyerId: string;
  mode: AgentMode;
  channel: MessageChannel;
  now?: Date;
  /** Откуда пришёл покупатель (пост, реклама): «Цена?» под постом про палитру — про палитру (C01). */
  context?: string;
};

/** Изменяемое состояние одного ответа: что инструменты показали и сделали. */
export type RoleSession = {
  buttons: ShownButton[];
  actions: DoneAction[];
  /** Строки, которые бот может цитировать как есть (названия товаров). */
  quoted: string[];
  /** Числа из результатов инструментов этого хода — проверка цен их знает. */
  allowedNumbers: number[];
  allowedContacts: string[];
  handedOff: boolean;
};

export const newSession = (): RoleSession => ({
  buttons: [],
  actions: [],
  quoted: [],
  allowedNumbers: [],
  allowedContacts: [],
  handedOff: false,
});

export type RoleContext = {
  aiEnabled: boolean;
  /** Язык ответа на этот ход (по последнему сообщению покупателя, иначе карточка). */
  lang: CheckLang;
  system: SystemBlock[];
  dailyCapMicroUsd: number | null;
  maxChars?: number;
  promptVariant?: string | null;
  check: Pick<
    CheckContext,
    "prices" | "allowedNumbers" | "shopText" | "deliveryTerms" | "quoted" | "allowedContacts"
  >;
};

export type AgentRole = {
  /** Назначение в журнале токенов (ai_usage.purpose). */
  purpose: "seller";
  tools: Anthropic.Tool[];
  loadContext(db: V4Db, a: TurnArgs & { text: string }): Promise<RoleContext>;
  runTool(
    db: V4Db,
    s: RoleSession,
    a: TurnArgs,
    name: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  /**
   * Ответ без модели, когда смысл однозначен («+» на предложение — заказ, C14).
   * null — дальше обычный путь. Вызывается под ходом, до брони.
   */
  shortcut?(
    db: V4Db,
    s: RoleSession,
    a: TurnArgs & { text: string; lang: CheckLang },
  ): Promise<{ text: string } | null>;
  /** Модель показала кнопку и не написала текста — заготовка на языке покупателя (G01). */
  buttonOnlyText?(lang: CheckLang): string;
  /** Простой ответ без ИИ (кнопки кладёт в s.buttons). check_failed — роль передаёт продавцу. */
  fallback(
    db: V4Db,
    s: RoleSession,
    a: TurnArgs & { text: string; lang: CheckLang },
    reason: FallbackReason,
  ): Promise<{ text: string }>;
};

export type AgentInput = TurnArgs & {
  db: V4Db;
  role: AgentRole;
  model: AgentModel;
  /** Наценка в базисных пунктах (wallet.markupBp поверх настройки оператора). */
  markupBp: () => Promise<number>;
  externalId: string | null;
  text: string;
  /** Общий бюджет ответа, мс (меньше 120 с — CLAUDE.md). */
  budgetMs?: number;
  /** Пауза перед повтором при 429/529 (в тестах — без ожидания). */
  sleep?: (ms: number) => Promise<void>;
  /** id хода (в тестах — постоянный). */
  turnId?: string;
};

export type AgentReply = {
  text: string;
  buttons: ShownButton[];
  actions: DoneAction[];
  source: "model" | "fallback";
  reason: FallbackReason | null;
  /** Списано с наценкой (в тени — сколько стоило платформе). */
  costMicroUsd: number;
  checkResult: string | null;
  messageId: number;
};

export type AgentResult =
  | {
      kind: "silent";
      reason: "duplicate" | "blocked" | "handoff" | "ai_off" | "queued" | "unknown_buyer" | "emoji";
    }
  | { kind: "reply"; replies: AgentReply[] };

const MAX_ROUNDS = 4;
/** Длинное сообщение покупателя уходит модели обрезанным (G10); в журнале — целиком. */
export const MODEL_MESSAGE_MAX = 4_000;
const MAX_PASSES = 3;
const DEFAULT_BUDGET_MS = 35_000;
const BUSY_RETRY_MS = 1_500;

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const { db, botId, buyerId, mode } = input;
  const args: TurnArgs = {
    botId,
    buyerId,
    mode,
    channel: input.channel,
    ...(input.now ? { now: input.now } : {}),
    ...(input.context ? { context: input.context } : {}),
  };
  const incoming = await recordIncoming(db, {
    ...args,
    externalId: input.externalId,
    text: input.text,
  });
  if (incoming.duplicate) return { kind: "silent", reason: "duplicate" };

  const state = (await db.call("agent_buyer_state", { p_bot_id: botId, p_buyer_id: buyerId }))[0]
    ?.agent_buyer_state as { found: boolean; blocked: boolean; handoff: boolean } | null;
  if (!state?.found) return { kind: "silent", reason: "unknown_buyer" };
  if (state.blocked) return { kind: "silent", reason: "blocked" };
  if (state.handoff) return { kind: "silent", reason: "handoff" };
  // Реакция или одни смайлики (❤️, 👍) — не вопрос и не «да»: молчим, модель не зовём (C13).
  // «+» — согласие (решение по Direct), его разбирает роль.
  if (!/[\p{L}\p{N}]/u.test(input.text) && input.text.trim() !== "+")
    return { kind: "silent", reason: "emoji" };

  const ctx = await input.role.loadContext(db, { ...args, text: input.text });
  if (!ctx.aiEnabled) return { kind: "silent", reason: "ai_off" };

  const turnId = input.turnId ?? crypto.randomUUID();
  if (!(await takeTurn(db, { botId, buyerId, turnId, ...(input.now ? { now: input.now } : {}) })))
    return { kind: "silent", reason: "queued" };

  const replies: AgentReply[] = [];
  const deadline = Date.now() + (input.budgetMs ?? DEFAULT_BUDGET_MS);
  // Последнее входящее, на которое уже ответили: модель видит весь журнал, так что
  // сообщения, пришедшие до чтения истории, отвечены этим же ответом (D08).
  const seen = { id: incoming.messageId };
  let text = input.text;
  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const passCtx = pass === 0 ? ctx : await input.role.loadContext(db, { ...args, text });
      replies.push(await answerOnce(input, args, passCtx, text, deadline, seen));
      const pending = await releaseTurn(db, { botId, buyerId, turnId, afterMessageId: seen.id });
      if (pending === 0) break;
      // За время хода пришли новые сообщения — отвечаем за них тем же ходом.
      const hist = await conversationHistory(db, { botId, buyerId, mode, limit: 20 });
      const fresh = hist.filter((m) => m.direction === "in" && m.id > seen.id);
      if (!fresh.length) break;
      seen.id = fresh.at(-1)!.id;
      text = fresh.map((m) => m.text).join("\n");
      if (Date.now() > deadline - 5_000) break;
    }
  } finally {
    // Ход отпускается и при сбое: иначе покупатель ждал бы до истечения хода.
    await releaseTurn(db, {
      botId,
      buyerId,
      turnId,
      afterMessageId: Number.MAX_SAFE_INTEGER,
    }).catch(() => undefined);
  }
  return { kind: "reply", replies };
}

async function answerOnce(
  input: AgentInput,
  args: TurnArgs,
  ctx: RoleContext,
  text: string,
  deadline: number,
  seen: { id: number },
): Promise<AgentReply> {
  const { db, role, botId, buyerId, mode } = input;
  const s = newSession();
  const nowArg = input.now ? { now: input.now } : {};

  const simple = async (reason: FallbackReason, cost = 0, checkResult: string | null = null) => {
    s.buttons = [];
    const fb = await role.fallback(db, s, { ...args, text, lang: ctx.lang }, reason);
    return save({ text: fb.text, source: "fallback", reason, cost, checkResult });
  };

  const save = async (r: {
    text: string;
    source: "model" | "fallback";
    reason: FallbackReason | null;
    cost: number;
    checkResult: string | null;
  }): Promise<AgentReply> => {
    const messageId = await recordReply(db, {
      botId,
      buyerId,
      channel: args.channel,
      text: r.text,
      buttons: s.buttons,
      actions: s.actions,
      mode,
      source: r.source,
      reason: r.reason,
      costMicroUsd: r.cost,
      promptVariant: ctx.promptVariant ?? null,
      checkResult: r.checkResult,
      ...nowArg,
    });
    return {
      text: r.text,
      buttons: s.buttons,
      actions: s.actions,
      source: r.source,
      reason: r.reason,
      costMicroUsd: r.cost,
      checkResult: r.checkResult,
      messageId,
    };
  };

  // 4а. Однозначный ответ без модели («+» на предложение).
  if (role.shortcut) {
    const quick = await role.shortcut(db, s, { ...args, text, lang: ctx.lang });
    if (quick)
      return save({
        text: quick.text,
        source: "fallback",
        reason: null,
        cost: 0,
        checkResult: null,
      });
  }

  // 5. Предел ответов ИИ покупателю в день (в тени не считаем: покупатель её не видит).
  if (mode !== "shadow" && !(await countAiReply(db, { botId, buyerId, ...nowArg })))
    return simple("limit_buyer");

  // 6. Бронь. Тень платит платформа — без брони.
  let holdId: number | null = null;
  if (mode !== "shadow") {
    const hold = await aiHold(db, {
      botId,
      buyerId,
      purpose: role.purpose,
      dailyCapMicroUsd: ctx.dailyCapMicroUsd,
      mode,
      ...nowArg,
    });
    if (!hold.ok) return simple(hold.reason === "limit_day" ? "limit_day" : "wallet_empty");
    holdId = hold.holdId;
  }

  let apiCost = 0;
  const finishMoney = async (): Promise<number> => {
    if (holdId === null) return withMarkup(apiCost, 0);
    if (apiCost === 0) {
      await aiRelease(db, { botId, holdId, ...nowArg });
      return 0;
    }
    const bp = await input.markupBp();
    return aiSettle(db, { botId, holdId, apiMicroUsd: apiCost, markupBp: bp, ...nowArg });
  };

  try {
    const history = await conversationHistory(db, { botId, buyerId, mode, limit: 20 });
    for (const m of history) if (m.direction === "in" && m.id > seen.id) seen.id = m.id;
    const messages = toModelMessages(history);
    const recentReplies = history.filter((m) => m.direction === "out").map((m) => m.text);
    const signal = AbortSignal.timeout(Math.max(1_000, deadline - Date.now()));

    const call = async (toolChoice: "auto" | "none"): Promise<AgentTurn> => {
      const req: AgentRequest = {
        system: ctx.system,
        messages,
        tools: role.tools,
        toolChoice,
        signal,
      };
      let turn: AgentTurn;
      try {
        turn = await input.model.turn(req);
      } catch (e) {
        if (!isModelBusy(e) || deadline - Date.now() < BUSY_RETRY_MS + 5_000) throw e;
        await (input.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(BUSY_RETRY_MS);
        turn = await input.model.turn(req);
      }
      apiCost += turn.costMicroUsd;
      await db.call("ai_log_usage", {
        p_bot_id: botId,
        p_purpose: role.purpose,
        p_model: turn.model,
        p_input: turn.inputTokens,
        p_output: turn.outputTokens,
        p_cost_micro_usd: turn.costMicroUsd,
        p_buyer_id: buyerId,
        ...(input.now ? { p_now: input.now.toISOString() } : {}),
      });
      return turn;
    };

    const texts: string[] = [];
    let modelFailed = false;
    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const choice = round === MAX_ROUNDS || s.handedOff ? "none" : "auto";
        const turn = await call(choice);
        if (turn.text.trim()) texts.push(turn.text.trim());
        if (choice === "none" || turn.toolCalls.length === 0) {
          if (turn.text.trim()) messages.push({ role: "assistant", content: turn.text.trim() });
          break;
        }
        const assistant: Anthropic.ContentBlockParam[] = [];
        if (turn.text.trim()) assistant.push({ type: "text", text: turn.text.trim() });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tc of turn.toolCalls) {
          assistant.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
          const out = await role.runTool(db, s, args, tc.name, tc.input);
          results.push({ type: "tool_result", tool_use_id: tc.id, content: JSON.stringify(out) });
        }
        messages.push(
          { role: "assistant", content: assistant },
          { role: "user", content: results },
        );
      }
    } catch (e) {
      console.error(`[v4 agent] модель не ответила: ${e instanceof Error ? e.message : String(e)}`);
      modelFailed = true;
    }
    if (modelFailed) {
      const cost = await finishMoney();
      holdId = null;
      return simple("model_failed", cost);
    }

    const checkCtx = (): CheckContext => ({
      ...ctx.check,
      lang: ctx.lang,
      allowedNumbers: [...ctx.check.allowedNumbers, ...s.allowedNumbers],
      quoted: [...ctx.check.quoted, ...s.quoted],
      allowedContacts: [...ctx.check.allowedContacts, ...s.allowedContacts],
      toolNames: role.tools.map((t) => t.name),
      offerShown: s.buttons.length > 0,
      recentReplies,
      ...(ctx.maxChars ? { maxChars: ctx.maxChars } : {}),
    });

    let draft = texts.join("\n\n").trim();
    if (!draft && s.buttons.length && role.buttonOnlyText) draft = role.buttonOnlyText(ctx.lang);
    let failure = checkReply(draft, checkCtx());
    if (failure) {
      // Одна попытка исправить: модель видит своё и конкретное замечание.
      if (messages.at(-1)?.role === "user")
        messages.push({ role: "assistant", content: draft || "…" });
      messages.push({
        role: "user",
        content: `[Проверка: ответ не отправлен — ${failure.hint}. Напиши ответ покупателю заново, коротко, без инструментов.]`,
      });
      try {
        const again = await call("none");
        draft = again.text.trim();
        failure = checkReply(draft, checkCtx());
      } catch {
        modelFailed = true;
      }
      if (modelFailed || failure) {
        const cost = await finishMoney();
        holdId = null;
        return simple(modelFailed ? "model_failed" : "check_failed", cost, failure?.code ?? null);
      }
    }
    const cost = await finishMoney();
    holdId = null;
    return save({ text: draft, source: "model", reason: null, cost, checkResult: "ok" });
  } finally {
    // Непредвиденный сбой между бронью и расчётом — бронь вернуть, а не ждать тика.
    if (holdId !== null) await aiRelease(db, { botId, holdId, ...nowArg }).catch(() => undefined);
  }
}

/**
 * Журнал → сообщения для модели. Ответ бота несёт показанные кнопки и действия
 * (ошибка 2 от 05.11: модель не знала, что кнопка уже была). Контакты покупателя
 * маскируются. Подряд идущие сообщения одной стороны склеиваются; начало — покупатель.
 */
export function toModelMessages(history: HistoryMessage[]): Anthropic.MessageParam[] {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of history) {
    const role = m.direction === "in" ? "user" : "assistant";
    let content = m.direction === "in" ? maskContacts(m.text) : m.text;
    if (m.direction === "in" && content.length > MODEL_MESSAGE_MAX)
      content = `${content.slice(0, MODEL_MESSAGE_MAX)} [обрезано: сообщение длиннее ${MODEL_MESSAGE_MAX} знаков]`;
    if (m.direction === "out") {
      if (m.author === "seller") content = `[ответ продавца] ${content}`;
      if (m.buttons.length)
        content += `\n[показаны кнопки: ${m.buttons.map((b) => b.label).join("; ")}]`;
      const acts = m.actions.map((a) => a.kind).filter(Boolean);
      if (acts.length) content += `\n[сделано: ${acts.join(", ")}]`;
    }
    content = content.trim();
    if (!content) continue;
    const last = out.at(-1);
    if (last && last.role === role) last.content += `\n${content}`;
    else out.push({ role, content });
  }
  while (out[0]?.role === "assistant") out.shift();
  if (!out.length) throw serverFailure("v4 agent: в журнале нет сообщения покупателя");
  return out;
}

/**
 * Язык ответа по последнему сообщению покупателя (ошибка 5 от 05.11: казахский
 * вопрос — русский ответ, потому что язык брался из карточки). Короткое или
 * неясное сообщение — язык карточки.
 */
export function detectLang(text: string, fallback: CheckLang): CheckLang {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 4) return fallback;
  // Узбекский кириллицей: ў, ҳ или узбекские слова («нархи», «қанча»); қ без ў — казахский (F05).
  if (/[ўҳ]/iu.test(text) || /(^|[^\p{L}])(нарх|қанча|керакми|борми|рахмат)/iu.test(text))
    return "uz";
  if (/[әғқңөұүһі]/iu.test(text)) return "kk";
  const cyr = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length / letters.length;
  // Казахский без казахских букв (с телефона без раскладки): «сатасызба», «керек», «саламатсыз» (F02).
  if (
    cyr > 0.5 &&
    /(сатасыз|саламатсыз|сәлеметсіз|керек|бар ма|барма|қалай|рахмет|жиберіңіз|жибериз)/iu.test(text)
  )
    return "kk";
  if (cyr > 0.5) return fallback === "kk" && letters.length < 12 ? "kk" : "ru";
  if (
    /[oOgG]['ʻ’‘`]|\b(salom|assalomu|narx|qancha|kerak|rahmat|qanday|bormi|sotib|kitob|nima|siz\b|\w+misiz\b)\w*/iu.test(
      text,
    )
  )
    return "uz";
  return "en";
}
