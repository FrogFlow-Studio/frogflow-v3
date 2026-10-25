export type CancelIntentTurn = { role: string; text: string };

const CANCEL_WORDS =
  /(?:^|[^\p{L}\p{N}])(?:отмен(?:и(?:те)?|ить|им|а|у)|аннулир(?:уй(?:те)?|овать|уем|а)|cancel(?:\s+(?:(?:my|the)\s+)?order)?|please\s+cancel|bekor\s+qil(?:ing)?|жой(?:ыңыз|ы|ылсын)?|күшін\s+жой|болдырмау)(?=$|[^\p{L}\p{N}])/iu;
const HOW_TO =
  /(?:^|[^\p{L}\p{N}])(?:как|можно\s+ли|могу\s+ли|подскажите,?\s+как|how|can\s+i|is\s+it\s+possible|qanday)(?=$|[^\p{L}\p{N}])/iu;
const ORDER_NUMBER_ONLY = /^\s*(?:№|#)?\s*\d{1,12}\s*$/u;
const ASKED_ORDER_NUMBER =
  /(?:номер|number|нөмір|raqam|(?:какой|which|qaysi|қай)\s+(?:номер|order|заказ|тапсырыс|raqam|buyurtma))/iu;

/** Вопрос «как отменить?» не считается разрешением менять статус заказа. */
export function isExplicitOrderCancellation(text: string): boolean {
  const value = text.trim();
  if (!value || !CANCEL_WORDS.test(value)) return false;
  if (HOW_TO.test(value) || /[?؟]\s*$/u.test(value)) return false;
  return true;
}

/**
 * Checkout обычно перехватывает цифры. Исключение: покупатель уже просил отмену,
 * консультант спросил номер, и покупатель ответил только номером.
 */
export function isCancellationOrderNumberReply(recent: unknown, incoming: string): boolean {
  if (!ORDER_NUMBER_ONLY.test(incoming)) return false;
  const turns = Array.isArray(recent)
    ? recent
        .filter((turn): turn is CancelIntentTurn => {
          if (!turn || typeof turn !== "object") return false;
          const candidate = turn as Record<string, unknown>;
          return typeof candidate.role === "string" && typeof candidate.text === "string";
        })
        .reverse()
    : [];
  const lastCustomer = turns.find((turn) => turn.role === "customer" || turn.role === "user");
  const lastAssistant = turns.find((turn) => turn.role === "assistant");
  return Boolean(
    lastCustomer &&
    isExplicitOrderCancellation(lastCustomer.text) &&
    lastAssistant &&
    ASKED_ORDER_NUMBER.test(lastAssistant.text),
  );
}

/**
 * Инструмент отмены разрешён, если текущая реплика одновременно содержит
 * прямую просьбу и номер либо предыдущая реплика покупателя была такой просьбой,
 * а сейчас он отвечает номером на уточнение консультанта.
 */
export function cancellationIntentMatchesOrder(
  recent: readonly CancelIntentTurn[],
  incoming: string,
  orderNumber: number,
): boolean {
  if (!Number.isSafeInteger(orderNumber) || orderNumber <= 0) return false;
  const escaped = String(orderNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const number = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:№|#)?\\s*${escaped}(?![\\p{L}\\p{N}])`, "u");
  if (isExplicitOrderCancellation(incoming)) return number.test(incoming);
  const lastCustomer = [...recent]
    .reverse()
    .find((turn) => turn.role === "customer" || turn.role === "user");
  return Boolean(
    lastCustomer && isExplicitOrderCancellation(lastCustomer.text) && number.test(incoming),
  );
}
