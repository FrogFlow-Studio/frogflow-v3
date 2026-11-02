import Anthropic from "@anthropic-ai/sdk";
import { callUsd } from "@/core/consultant/engine.server";
import { previewReadonly } from "@/lib/preview";
import { serverFailure } from "@/lib/server-failure";
import type { SellerModel } from "./model";

/** Модель по умолчанию для продавца v4. Выбор модели — до живой проверки качества. */
export const SELLER_MODEL = "claude-sonnet-5";

export function anthropicSellerModel(apiKey: string, model = SELLER_MODEL): SellerModel {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    async turn(req) {
      // Предпросмотр: модель не зовём; продавец ответит простым ответом без модели.
      if (previewReadonly()) throw serverFailure("v4 seller: предпросмотр, модель выключена");
      const res = await client.messages.create(
        {
          model,
          max_tokens: 1024,
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: req.messages,
          tools: req.tools,
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
