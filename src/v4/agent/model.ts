import type Anthropic from "@anthropic-ai/sdk";

/**
 * Модель ядра за интерфейсом. В тестах — записанный сценарий (`scriptedAgentModel`):
 * живую модель тесты не зовут (Яков 27.11: без ключа). В проде — Anthropic
 * (`anthropic.server.ts`). Промпт — блоками: неизменный (общий кэш на все
 * магазины), магазин (кэш на магазин), покупатель (без кэша).
 */

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type AgentTurn = {
  text: string;
  toolCalls: ToolCall[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Цена API без наценки, микродоллары. */
  costMicroUsd: number;
};

export type SystemBlock = { text: string; cache: boolean };

export type AgentRequest = {
  system: SystemBlock[];
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  /** none — последний круг и повтор после проверки: только текст. */
  toolChoice: "auto" | "none";
  signal: AbortSignal;
};

export type AgentModel = { turn(req: AgentRequest): Promise<AgentTurn> };

/**
 * Заглушка вместо живой модели. Вебхук v4 отдаёт её, пока нет отдельного «да»
 * на прогон: `turn` не зовёт API, а адаптер с этой моделью в мозг не входит.
 */
export const parkedAgentModel: AgentModel & { parked: true } = {
  parked: true,
  async turn() {
    throw new Error("v4:live_model_parked");
  },
};

export function isParkedModel(model: AgentModel): boolean {
  return "parked" in model && (model as { parked?: boolean }).parked === true;
}

/** Перегрузка или лимит API (429, 529): один повтор допустим — это вызов модели, не отправка. */
export class ModelBusyError extends Error {
  override name = "ModelBusyError";
}

export function isModelBusy(e: unknown): boolean {
  if (e instanceof ModelBusyError) return true;
  const status = (e as { status?: unknown } | null)?.status;
  return status === 429 || status === 529;
}

export type ScriptedTurn = Partial<AgentTurn> | { throws: unknown };

/** Записанный сценарий: каждый вызов отдаёт следующий ход; запросы сохраняются. */
export function scriptedAgentModel(turns: ScriptedTurn[]): AgentModel & {
  requests: AgentRequest[];
} {
  const requests: AgentRequest[] = [];
  let i = 0;
  return {
    requests,
    async turn(req) {
      requests.push({ ...req, messages: structuredClone(req.messages) });
      const t = turns[i++];
      if (!t) throw new Error(`scriptedAgentModel: ход ${i} не записан`);
      if ("throws" in t) throw t.throws;
      return {
        text: t.text ?? "",
        toolCalls: t.toolCalls ?? [],
        model: t.model ?? "scripted",
        inputTokens: t.inputTokens ?? 1000,
        outputTokens: t.outputTokens ?? 100,
        costMicroUsd: t.costMicroUsd ?? 4000,
      };
    },
  };
}
