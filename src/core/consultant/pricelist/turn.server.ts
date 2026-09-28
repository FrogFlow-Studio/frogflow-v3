import type Anthropic from "@anthropic-ai/sdk";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { ConsultantResult, ConsultantState, Handoff } from "../engine.server";
import {
  decidePricelistReply,
  HANDOFF_REASON_LABEL,
  loadPricelistData,
  modelParams,
  type PricelistData,
  type PricelistDecision,
  type PricelistInput,
} from "./engine.server";
import type { V2Image } from "./images";

/** Фраза передачи, когда модель ничего не написала сама (v1 HANDOFF_TO_MANAGER_REPLY). */
export const HANDOFF_REPLY = "Спасибо. Я передам ваш вопрос менеджеру, он скоро с вами свяжется.";

export type PricelistTurn = {
  reply: string;
  handoff: Handoff | null;
  clearError: boolean;
  patch: Partial<ConsultantState>;
  historyReply?: string;
  attachments?: ConsultantResult["attachments"];
  tools: string[];
};

/**
 * Один ход консультанта по прайсу внутри runConsultant: данные магазина,
 * решение модели (engine.server) и перевод его в общий результат — передачу
 * менеджеру, патч состояния диалога, вложения.
 */
export async function runPricelistTurn(
  ctx: TenantContext,
  args: {
    text: string;
    state: ConsultantState;
    model: string;
    callModel: (
      params: Anthropic.MessageCreateParamsNonStreaming,
    ) => Promise<Anthropic.Message | "limited" | "late">;
    story?: { storyId: string | null; mediaUrl: string | null };
    imageUrls?: string[];
    images?: V2Image[];
    /** Для тестов: данные магазина без базы. */
    data?: PricelistData;
    now?: Date;
    fetchImage?: PricelistInput["fetchImage"];
  },
): Promise<PricelistTurn> {
  const data = args.data ?? (await loadPricelistData(ctx));
  const decision = await decidePricelistReply(data, {
    text: args.text,
    state: args.state,
    story: args.story,
    imageUrls: args.imageUrls,
    images: args.images,
    now: args.now,
    fetchImage: args.fetchImage,
    call: (req) => args.callModel({ model: args.model, ...req, ...modelParams(args.model) }),
  });
  return toTurn(decision, args.text);
}

/** Решение модели → общий результат консультанта. */
export function toTurn(d: PricelistDecision, incoming: string): PricelistTurn {
  const patch: Partial<ConsultantState> = { ...d.statePatch };
  const base = { patch, tools: d.tools, attachments: d.attachments };
  if (d.handoff) {
    const reason = HANDOFF_REASON_LABEL[d.handoff.reason];
    return {
      ...base,
      reply: d.reply || HANDOFF_REPLY,
      historyReply: d.reply ? d.historyText : undefined,
      clearError: true,
      handoff: {
        // Покупка и опт — заявка: менеджер получает готовый заказ.
        kind:
          d.handoff.reason === "purchase" || d.handoff.reason === "wholesale" ? "lead" : "handoff",
        reason,
        customerName: d.statePatch.profile?.name,
        customerContact: d.handoff.phone,
        summary: d.handoff.summary || `Клиент написал: «${incoming.slice(0, 200)}»`,
      },
    };
  }
  if (!d.reply) {
    // Модель не ответила (лимит частоты, потолок времени, пустой ответ).
    // Молчать нельзя — человек ждёт; отдаём менеджеру.
    const why =
      d.stopped === "limited"
        ? "лимит частоты"
        : d.stopped === "late"
          ? "долго искал"
          : "пустой ответ модели";
    return {
      ...base,
      reply: HANDOFF_REPLY,
      clearError: false,
      handoff: {
        kind: "handoff",
        reason: "unknown_question",
        summary: `ИИ-консультант не ответил (${why}). Клиент написал: «${incoming.slice(0, 200)}»`,
      },
    };
  }
  return {
    ...base,
    reply: d.reply,
    historyReply: d.historyText !== d.reply ? d.historyText : undefined,
    clearError: true,
    handoff: null,
  };
}
