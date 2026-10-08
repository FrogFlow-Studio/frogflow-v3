import type { ConsultantState, ConsultantTurn } from "./engine.server";

/**
 * Тест-чат админки с историей (партия 3.6): продавец переписывается с
 * консультантом как покупатель — уточнение, страна и рубли, передача по ходу
 * диалога. Состояние пробного диалога живёт только в браузере и приходит с
 * каждым вопросом; сервер ничего не пишет (runConsultant, dryRun).
 */

/** Сколько реплик истории держит тест-чат — как настоящий диалог. */
export const TEST_HISTORY_TURNS = 16;
/** Предел присланного состояния: больше — начать заново. */
export const TEST_STATE_MAX_CHARS = 16_000;

/** Поля, которые в пробном диалоге не переносятся: пауза, очередь, ответы менеджера. */
const DROP = new Set([
  "recent",
  "paused_until",
  "resumed_at",
  "relayed",
  "inbox",
  "turn",
  "last_reply_at",
  "followup_for",
]);

/** Состояние без служебных полей; не объект или слишком большое — пусто. */
export function cleanTestExtra(extra: unknown): Record<string, unknown> {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra as Record<string, unknown>))
    if (!DROP.has(k)) out[k] = v;
  return JSON.stringify(out).length > TEST_STATE_MAX_CHARS ? {} : out;
}

/** Память пробного диалога из JSON-строки браузера; кривая — пусто. */
export function parseTestExtra(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return cleanTestExtra(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

/** Состояние для хода: история реплик и то, что консультант запомнил раньше. */
export function testChatState(history: ConsultantTurn[], extra: unknown): ConsultantState {
  return {
    ...(cleanTestExtra(extra) as ConsultantState),
    recent: history.slice(-TEST_HISTORY_TURNS),
  };
}

/** После ответа: история с новой парой реплик и обновлённая память консультанта. */
export function nextTestChat(
  history: ConsultantTurn[],
  question: string,
  reply: string,
  extraBefore: unknown,
  stateAfter: ConsultantState | undefined,
): { history: ConsultantTurn[]; extra: Record<string, unknown> } {
  return {
    history: [
      ...history,
      { role: "customer" as const, text: question.slice(0, 1500) },
      { role: "assistant" as const, text: reply.slice(0, 700) },
    ].slice(-TEST_HISTORY_TURNS),
    extra: cleanTestExtra(stateAfter ?? extraBefore),
  };
}
