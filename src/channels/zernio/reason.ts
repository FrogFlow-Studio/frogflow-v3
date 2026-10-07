import { makeReason } from "@/core/chat/reason";
import { classifyIncoming, isCancel, matchDirectCommand } from "./shop-flow";

/**
 * «Почему бот так ответил» для Direct: что бот увидел во входящем. Считается
 * теми же разборщиками, что и сценарий (shop-flow), по тексту и шагу, и
 * записывается в журнал диалога короткой строкой. Текст покупателя в причину
 * не попадает: только названия правил.
 *
 *   step=<шаг сценария>  cmd=<команда>  cancel  parsed=<codes|code|yes|thanks|question>
 *   skipped=phone (номер телефона не принят за коды товаров)
 */
export function explainIncoming(input: {
  mode: string | undefined;
  text: string;
  /** Кнопка (postback): сам payload — служебное слово, текста нет. */
  postback?: string | null;
  /** Шаг был заданным давно и сброшен. */
  stale?: boolean;
  /** Слово-вызов продавца. */
  trigger?: boolean;
  attachments?: number;
}): string | null {
  const step = input.mode && input.mode !== "idle" ? input.mode : "idle";
  if (input.postback) return makeReason({ step, button: input.postback });
  if (input.attachments && !input.text.trim()) return makeReason({ step, parsed: "attachment" });
  if (!input.text.trim()) return makeReason({ step, parsed: "empty" });
  const base = { step, stale: input.stale ? true : undefined };
  if (input.trigger) return makeReason({ ...base, cmd: "catalog", trigger: true });
  if (isCancel(input.text)) return makeReason({ ...base, cancel: true });
  const cmd = matchDirectCommand(input.text);
  if (cmd) return makeReason({ ...base, cmd });
  const kind = classifyIncoming(input.text);
  switch (kind.kind) {
    case "phone":
      return makeReason({ ...base, skipped: "phone" });
    case "product_number":
      return makeReason({ ...base, parsed: "code" });
    case "product_numbers":
      return makeReason({ ...base, parsed: "codes" });
    case "product_tag":
      return makeReason({ ...base, parsed: "tag" });
    case "affirmative":
      return makeReason({ ...base, parsed: "yes" });
    case "dismissal":
      return makeReason({ ...base, parsed: "thanks" });
    default:
      return makeReason({ ...base, parsed: "question" });
  }
}
