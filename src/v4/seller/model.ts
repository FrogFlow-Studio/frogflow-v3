import type Anthropic from "@anthropic-ai/sdk";

/**
 * Модель ИИ-продавца v4 за интерфейсом. В тестах — записанный сценарий
 * (`scriptedModel`): живую модель тесты не зовут (решение Якова 02.11:
 * без живых прогонов, пока нет бюджета). В проде — Anthropic (`anthropic.server.ts`).
 */

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type ModelTurn = {
  text: string;
  toolCalls: ToolCall[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
};

export type ModelRequest = {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  signal: AbortSignal;
};

export type SellerModel = { turn(req: ModelRequest): Promise<ModelTurn> };

/** Записанный сценарий для тестов: каждый вызов отдаёт следующий ход; запросы сохраняются. */
export function scriptedModel(turns: Array<Partial<ModelTurn>>): SellerModel & {
  requests: ModelRequest[];
} {
  const requests: ModelRequest[] = [];
  let i = 0;
  return {
    requests,
    async turn(req) {
      requests.push({ ...req, messages: [...req.messages] });
      const t = turns[i++];
      if (!t) throw new Error(`scriptedModel: ход ${i} не записан`);
      return {
        text: t.text ?? "",
        toolCalls: t.toolCalls ?? [],
        model: t.model ?? "scripted",
        inputTokens: t.inputTokens ?? 1000,
        outputTokens: t.outputTokens ?? 100,
        costMicroUsd: t.costMicroUsd ?? 2500,
      };
    },
  };
}
