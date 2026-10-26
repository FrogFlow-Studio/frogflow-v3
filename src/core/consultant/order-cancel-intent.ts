export type CancelIntentTurn = { role: string; text: string };

const CANCEL_WORDS =
  /(?:^|[^\p{L}\p{N}])(?:отмен(?:и(?:те)?|ить|им|а|у)|аннулир(?:уй(?:те)?|овать|уем|а)|cancel(?:\s+(?:(?:my|the)\s+)?order)?|please\s+cancel|bekor\s+qil(?:ing)?|жой(?:ыңыз|ы|ылсын)?|күшін\s+жой|болдырмау)(?=$|[^\p{L}\p{N}])/iu;
const HOW_TO =
  /(?:^|[^\p{L}\p{N}])(?:как|можно\s+ли|могу\s+ли|подскажите,?\s+как|how|can\s+i|is\s+it\s+possible|qanday)(?=$|[^\p{L}\p{N}])/iu;
const ORDER_NUMBER_ONLY = /^\s*(?:№|#)?\s*\d{1,12}\s*$/u;
const AFFIRMATION =
  /^\s*(?:да|ага|угу|давайте|давай|конечно|отмените|отменяйте|отменить|подтверждаю|иә|ия|йә|жарайды|иә,?\s*жойыңыз|yes|yep|ok|okay|sure|please|ha|xa|mayli|albatta)(?:[\s,]+(?:да|пожалуйста|отмените|отменяйте|давайте|please|жойыңыз))*\s*[.!)\u{1F44D}]*\s*$/iu;
const ASKED_CANCEL_CONFIRMATION = /(?:отмен|cancel|жой|bekor)[^?؟]*[?؟]/iu;
const ASKED_ORDER_NUMBER =
  /(?:номер|number|нөмір|raqam|(?:какой|which|qaysi|қай)\s+(?:номер|order|заказ|тапсырыс|raqam|buyurtma))/iu;

/** Вопрос «как отменить?» не считается разрешением менять статус заказа. */
export function isExplicitOrderCancellation(text: string): boolean {
  const value = text.trim();
  if (!value || !CANCEL_WORDS.test(value)) return false;
  if (HOW_TO.test(value) || /[?؟]\s*$/u.test(value)) return false;
  return true;
}

function intentTurns(recent: unknown): CancelIntentTurn[] {
  return Array.isArray(recent)
    ? recent.filter((turn): turn is CancelIntentTurn => {
        if (!turn || typeof turn !== "object") return false;
        const candidate = turn as Record<string, unknown>;
        return typeof candidate.role === "string" && typeof candidate.text === "string";
      })
    : [];
}

function orderNumberPattern(orderNumber: number): RegExp {
  const escaped = String(orderNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:№|#)?\\s*${escaped}(?![\\p{L}\\p{N}])`, "u");
}

/**
 * Короткое «да» в ответ на вопрос консультанта «Отменить заказ №270?», когда
 * перед этим покупатель прямо просил отмену (Копилка 24.10, заказ #270: без
 * этого «Да» уходило в шаг оплаты, а отмену бот не подтверждал). Без номера
 * проверяет только форму; с номером — что консультант спросил именно о нём.
 */
export function isCancellationConfirmation(
  recent: unknown,
  incoming: string,
  orderNumber?: number,
): boolean {
  if (!AFFIRMATION.test(incoming)) return false;
  const turns = intentTurns(recent).reverse();
  const lastAssistantIndex = turns.findIndex((turn) => turn.role === "assistant");
  if (lastAssistantIndex < 0) return false;
  const lastAssistant = turns[lastAssistantIndex]!;
  const customerBefore = turns
    .slice(lastAssistantIndex + 1)
    .find((turn) => turn.role === "customer" || turn.role === "user");
  if (!customerBefore || !isExplicitOrderCancellation(customerBefore.text)) return false;
  if (!ASKED_CANCEL_CONFIRMATION.test(lastAssistant.text)) return false;
  if (!/\d/u.test(lastAssistant.text)) return false;
  if (orderNumber === undefined) return true;
  return (
    Number.isSafeInteger(orderNumber) &&
    orderNumber > 0 &&
    orderNumberPattern(orderNumber).test(lastAssistant.text)
  );
}

/**
 * Checkout обычно перехватывает цифры. Исключение: покупатель уже просил отмену,
 * консультант спросил номер, и покупатель ответил только номером.
 */
export function isCancellationOrderNumberReply(recent: unknown, incoming: string): boolean {
  if (!ORDER_NUMBER_ONLY.test(incoming)) return false;
  const turns = intentTurns(recent).reverse();
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
 * Инструмент отмены разрешён, если покупатель ответил «да» на вопрос
 * «Отменить заказ №…?» об этом номере, текущая реплика одновременно содержит
 * прямую просьбу и номер либо предыдущая реплика покупателя была такой просьбой,
 * а сейчас он отвечает номером на уточнение консультанта.
 */
export function cancellationIntentMatchesOrder(
  recent: readonly CancelIntentTurn[],
  incoming: string,
  orderNumber: number,
): boolean {
  if (!Number.isSafeInteger(orderNumber) || orderNumber <= 0) return false;
  const number = orderNumberPattern(orderNumber);
  if (isCancellationConfirmation(recent, incoming, orderNumber)) return true;
  if (isExplicitOrderCancellation(incoming)) return number.test(incoming);
  const lastCustomer = [...recent]
    .reverse()
    .find((turn) => turn.role === "customer" || turn.role === "user");
  return Boolean(
    lastCustomer && isExplicitOrderCancellation(lastCustomer.text) && number.test(incoming),
  );
}
