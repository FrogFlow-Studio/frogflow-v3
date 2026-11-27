import Anthropic from "@anthropic-ai/sdk";
import { modelParams } from "@/core/ai/pure";
import { callUsd } from "@/core/consultant/engine.server";
import { previewReadonly } from "@/lib/preview";
import { serverFailure } from "@/lib/server-failure";
import type { AgentModel } from "./model";

/**
 * Модель ядра на Anthropic. Порядок кэша: инструменты → неизменный блок (общий
 * для всех магазинов, горячий, пока пишет хоть кто-то на платформе) → блок
 * магазина → блок покупателя без кэша (проект 4.4: тихому магазину это снижает
 * цену ответа почти вдвое). Повторов в SDK нет: 429/529 повторяет ядро один раз.
 */
export const AGENT_MODEL = "claude-sonnet-5";

export function anthropicAgentModel(apiKey: string, model = AGENT_MODEL): AgentModel {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    async turn(req) {
      if (previewReadonly()) throw serverFailure("v4 agent: предпросмотр, модель выключена");
      const res = await client.messages.create(
        {
          model,
          max_tokens: 1024,
          ...modelParams(model),
          system: req.system.map((b) => ({
            type: "text" as const,
            text: b.text,
            ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
          })),
          messages: req.messages,
          tools: req.tools,
          tool_choice: { type: req.toolChoice },
        },
        { signal: req.signal },
      );
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const toolCalls = res.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          name: b.name,
          input: (b.input ?? {}) as Record<string, unknown>,
        }));
      return {
        text,
        toolCalls,
        model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        costMicroUsd: Math.ceil(callUsd(model, res.usage) * 1_000_000),
      };
    },
  };
}
