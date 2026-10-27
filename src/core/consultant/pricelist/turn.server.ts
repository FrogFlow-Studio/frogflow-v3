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
import type { Locale } from "@/core/i18n/locale";
import { handoffSummary, sellerLocaleSafe } from "@/core/ai/seller-text";
import { pricelistHandoffReply, rubApproxNote } from "../messages";

/** Фраза передачи, когда модель ничего не написала сама (v1 HANDOFF_TO_MANAGER_REPLY), по-русски. */
export const HANDOFF_REPLY = pricelistHandoffReply("ru");

export type PricelistTurn = {
  reply: string;
  handoff: Handoff | null;
  clearError: boolean;
  patch: Partial<ConsultantState>;
  historyReply?: string;
  attachments?: ConsultantResult["attachments"];
  tools: string[];
  rate?: ConsultantResult["rate"];
  /** Сбой по ходу ответа, который покупателя не остановил (база знаний не прочиталась): в последнюю ошибку. */
  error?: string;
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
    story?: import("../story-tags").StoryRef;
    imageUrls?: string[];
    images?: V2Image[];
    /** Язык покупателя — для готовых фраз (передача менеджеру). */
    locale?: Locale;
    /** Язык продавца — для сводки передачи, написанной кодом. */
    sellerLocale?: Locale;
    /** Для тестов: данные магазина без базы. */
    data?: PricelistData;
    now?: Date;
    fetchImage?: PricelistInput["fetchImage"];
    /** Канал диалога: в Instagram и WhatsApp заказ передаётся без телефона. */
    channel?: string;
    contact?: string;
    dryRun?: boolean;
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
    channel: args.channel,
    call: (req) => args.callModel({ model: args.model, ...req, ...modelParams(args.model) }),
  });
  if (decision.missingMedia?.length && !args.dryRun) {
    const { recordMediaDemand } = await import("./media-catalog.server");
    for (const item of decision.missingMedia) {
      void recordMediaDemand(ctx, item.product, args.contact, args.text).catch(() => {});
    }
  }
  const r = data.rate;
  // Рубли просят, а курса нет — продавцу раз в сутки (условная отметка).
  if (decision.rateMissing) {
    const { noticeStaleRate } = await import("./rate-notice.server");
    await noticeStaleRate(ctx);
  }
  const turn = toTurn(decision, args.text, {
    locale: args.locale,
    sellerLocale:
      args.sellerLocale ?? (decision.priceBlocked ? await sellerLocaleSafe(ctx) : undefined),
  });
  if (data.knowledgeError) {
    turn.tools = ["kb_load_failed", ...turn.tools];
    turn.clearError = false;
    turn.error = [
      `база знаний консультанта не прочитана, ответ без неё: ${data.knowledgeError}`,
      turn.error,
    ]
      .filter(Boolean)
      .join("; ");
  }
  return {
    ...turn,
    rate: r ? { value: r.rate, updatedAt: r.updatedAt, source: r.source ?? null } : null,
  };
}

/** Решение модели → общий результат консультанта. */
export function toTurn(
  decision: PricelistDecision,
  incoming: string,
  opts: { locale?: Locale; sellerLocale?: Locale } = {},
): PricelistTurn {
  // Рубли по курсу старше суток — покупатель видит, что сумма ориентировочная.
  const d =
    decision.rateApprox && decision.reply.includes("₽")
      ? { ...decision, reply: `${decision.reply}\n\n${rubApproxNote(opts.locale ?? "ru")}` }
      : decision;
  const patch: Partial<ConsultantState> = { ...d.statePatch };
  const base = { patch, tools: [...d.tools], attachments: d.attachments };
  const handoffText = pricelistHandoffReply(opts.locale ?? "ru");
  // Модель не ответила (лимит частоты, потолок времени, пустой ответ) — в
  // последнюю ошибку: по ней оператор видит, что консультант сбоит.
  const why =
    d.stopped === "limited"
      ? "лимит частоты"
      : d.stopped === "late"
        ? "долго искал"
        : "пустой ответ модели";
  const silentError = `ИИ-консультант не ответил (${why}); вопрос передан менеджеру`;
  if (d.handoff) {
    const reason = HANDOFF_REASON_LABEL[d.handoff.reason];
    // Цена не по прайсу и после переписывания: менеджеру — почему, на его языке.
    const summary = d.priceBlocked
      ? [handoffSummary(opts.sellerLocale ?? "ru", "price", incoming), d.handoff.summary]
          .filter(Boolean)
          .join("\n")
      : d.handoff.summary || `Клиент написал: «${incoming.slice(0, 200)}»`;
    return {
      ...base,
      reply: d.reply || handoffText,
      historyReply: d.reply ? d.historyText : undefined,
      clearError: !d.priceBlocked && !(d.stopped && !d.reply),
      ...(d.priceBlocked
        ? {
            error:
              "ответ консультанта не отправлен: цена не по прайсу и после переписывания; вопрос передан менеджеру",
          }
        : d.stopped && !d.reply
          ? { error: silentError }
          : {}),
      handoff: {
        // Покупка и опт — заявка: менеджер получает готовый заказ.
        kind:
          d.handoff.reason === "purchase" || d.handoff.reason === "wholesale" ? "lead" : "handoff",
        reason,
        customerName: d.statePatch.profile?.name,
        customerContact: d.handoff.phone,
        summary,
      },
    };
  }
  if (!d.reply) {
    // Молчать нельзя — человек ждёт; отдаём менеджеру.
    return {
      ...base,
      reply: handoffText,
      clearError: false,
      error: silentError,
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
