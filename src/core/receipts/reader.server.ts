/**
 * Вызов модели, которая читает чек (правила и запрос — reader.ts). Ключ
 * платформы (ANTHROPIC_API_KEY), как у остальных ИИ-функций; без повторов:
 * упавший вызов — чек смотрит продавец.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { modelParams } from "@/core/ai/pure";
import { previewReadonly, PREVIEW_AI_OFF } from "@/lib/preview";
import { serverFailure } from "@/lib/server-failure";
import {
  RECEIPT_AI_MAX_TOKENS,
  RECEIPT_AI_MODEL,
  RECEIPT_AI_TIMEOUT_MS,
  RECEIPT_SYSTEM,
  RECEIPT_TOOL,
} from "./reader";

/** Что уходит в модель: картинка или PDF целиком. */
export type ReceiptFile =
  { kind: "image"; mediaType: string; base64: string } | { kind: "pdf"; base64: string };

export type CallReceiptModel = (
  file: ReceiptFile,
) => Promise<{ input: unknown; usage?: { input_tokens?: number; output_tokens?: number } }>;

const liveModel: CallReceiptModel = async (file) => {
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw serverFailure("ИИ-ключ платформы не задан");
  const source =
    file.kind === "pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: file.base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: file.mediaType, data: file.base64 },
        };
  const res = await new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: RECEIPT_AI_TIMEOUT_MS,
  }).messages.create({
    model: RECEIPT_AI_MODEL,
    max_tokens: RECEIPT_AI_MAX_TOKENS,
    system: RECEIPT_SYSTEM,
    tools: [RECEIPT_TOOL],
    tool_choice: { type: "tool", name: RECEIPT_TOOL.name },
    messages: [{ role: "user", content: [source, { type: "text", text: "Прочитай этот чек." }] }],
    ...modelParams(RECEIPT_AI_MODEL),
  } as never);
  const r = res as unknown as {
    stop_reason?: string;
    content: Array<{ type: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const tool = r.content.find((b) => b.type === "tool_use" && b.name === RECEIPT_TOOL.name);
  return { input: tool?.input ?? null, usage: r.usage };
};

let modelOverride: CallReceiptModel | null = null;
/** Тесты: подставить ответ модели. */
export function setReceiptModelForTests(fn: CallReceiptModel | null) {
  modelOverride = fn;
}

/** Модель доступна: ключ есть (тесты подставляют модель сами). */
export function receiptModelConfigured(): boolean {
  if (modelOverride) return true;
  try {
    return Boolean(env().ANTHROPIC_API_KEY?.trim());
  } catch {
    return false;
  }
}

export async function callReceiptModel(file: ReceiptFile) {
  // Предпросмотр (ветка на Vercel) в живую модель не ходит.
  if (previewReadonly()) throw new Error(PREVIEW_AI_OFF);
  return (modelOverride ?? liveModel)(file);
}
