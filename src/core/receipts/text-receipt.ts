/**
 * Чек текстом (AATeach 11.10, #1391): Kaspi не даёт сделать скриншот, и
 * покупатель вставляет текст из приложения — «Оплата совершена 800 ₸ … № чека
 * QR18040511543». Такой текст на шаге оплаты принимается как чек: заказ идёт
 * продавцу на проверку, как фото. Настройка продавца — `chat_receipt_text`.
 */
export const CHAT_RECEIPT_TEXT_KEY = "chat_receipt_text";

/** "false" — продавец выключил; без значения — включено. */
export function receiptTextOn(raw: string | null | undefined): boolean {
  return raw !== "false";
}

/**
 * Номер операции из банковского приложения: «№ чека QR18040511543», «№ 1234567890».
 * Просто «номер 8777…» — телефон, не чек.
 */
const OPERATION_NO =
  /(?:№\s*(?:чека|квитанции|операции|документа|транзакции)?|номер\s+(?:чека|квитанции|операции|документа|транзакции))\s*[:#]?\s*([A-ZА-Я]{0,4}\d{6,})/iu;
/** Номер Kaspi QR без «№». */
const KASPI_QR = /\b(QR\d{6,})\b/i;

/** Сумма с валютой: «800 ₸», «1 500 тг», «132 руб», «31 655 сум», «7 BYN». */
const AMOUNT =
  /\d[\d\s.,]*\s*(₸|тг|тенге|теңге|₽|руб|р\.|rub|kzt|сум|so[‘'`]?m|uzs|byn|бел\.?\s*руб|сом|kgs|\$|usd)/iu;

/** Слова банковского чека, а не рассказа «я оплатила». */
const RECEIPT_WORDS =
  /(оплата\s+(совершена|прошла|выполнена|успешн)|перевод\s+(выполнен|совершен|успешн|отправлен)|платеж\p{L}*\s+(проведен|выполнен|успешн)|платёж\p{L}*\s+(проведён|выполнен|успешн)|успешно|квитанци|получатель|отправитель|комисси|дата\s+и\s+время|төлем\s+жасалды|сәтті|to[‘'`]?lov\s+amalga|muvaffaqiyatli|payment\s+(successful|completed))/iu;

/**
 * В тексте есть сумма с валютой: тогда это может быть уведомление банка без
 * слов чека («Покупка: 1 700 ₸ / ИП … / Доступно: …») — решает модель
 * (core/inbox/triage, text_receipt). Без суммы модель не зовём.
 */
export function mentionsAmount(text: string): boolean {
  return AMOUNT.test(text);
}

/** Номер операции для отпечатка чека: тот же номер по другому заказу — повтор. */
export function receiptOperationNo(text: string): string | null {
  const m = KASPI_QR.exec(text) ?? OPERATION_NO.exec(text);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Похоже на вставленный текст чека: номер операции, или сумма с валютой вместе
 * со словами чека («Оплата совершена», «Перевод выполнен», «Получатель»).
 * «Я оплатила 800 тг» — не чек: это рассказ, бот по-прежнему просит скриншот.
 */
export function looksLikeTextReceipt(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  if (receiptOperationNo(t)) return true;
  return AMOUNT.test(t) && RECEIPT_WORDS.test(t);
}
