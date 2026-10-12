/**
 * Оплата и чеки в переписке Direct/WhatsApp — дневной срез AATeach 12.10
 * (решения Якова 1–4). Чистые правила: ключи настроек и окна. Что написал
 * покупатель («не прошло», «скриншот не отправляется»), решает модель
 * (core/inbox/triage), исполнение — адаптер канала (shop/pay-trouble.server).
 */

/** Номер товара, пока свежий заказ ждёт оплату, — сначала про заказ. «false» — выключено. */
export const CHAT_UNPAID_NUMBER_KEY = "chat_unpaid_number";
/** Почта или «пришлите ещё раз» по заказу старше RESEND_OLD_DAYS — сначала спросить. «false» — выключено. */
export const RESEND_OLD_CONFIRM_KEY = "resend_old_confirm";

export function unpaidNumberOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "false";
}
export function resendOldConfirmOn(raw: string | null | undefined): boolean {
  return raw?.trim() !== "false";
}

/** Заказ старше — повторная отправка только после «да». */
export const RESEND_OLD_DAYS = 14;
/** Ответ «да» на вопрос о повторной отправке ждём столько. */
export const RESEND_ASK_MS = 30 * 60_000;
/** Чек снимается, если «не прошло» пришло не позже стольки после него. */
export const PROOF_WITHDRAW_MS = 15 * 60_000;
/**
 * Фото и «Не проходит» — два сообщения, которые обрабатываются одновременно
 * (kopats23: 18:27:06 и 18:27:09). Слова, отправленные не раньше чем за
 * столько до фото, относятся к нему: фото не чек. Раньше — это уже новая
 * попытка оплаты, и чек принимается.
 */
export const PAY_FAILED_NEAR_MS = 5_000;
/** «Платёж не прошёл» по одному заказу — не чаще раза в это время. */
export const PAY_FAILED_REPLY_MS = 30 * 60_000;

/** Голый номер: «3», «003», «#482». */
export function isBareNumber(text: string): boolean {
  return /^\s*#?\d{1,4}\s*$/.test(text);
}

/** Согласие на «прислать ещё раз?» на четырёх языках. */
const YES = new Set([
  "да",
  "ага",
  "угу",
  "ок",
  "окей",
  "давайте",
  "отправьте",
  "пришлите",
  "да пожалуйста",
  "да отправьте",
  "да пришлите",
  "иә",
  "ия",
  "ok",
  "okay",
  "yes",
  "yes please",
  "ha",
  "xa",
  "albatta",
  "+",
]);
export function isYes(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[.!,)😊🙏👍]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return YES.has(t);
}

/** Заказ старше RESEND_OLD_DAYS дней. */
export function isOldOrder(createdAt: string, now = Date.now()): boolean {
  const at = Date.parse(createdAt);
  return Number.isFinite(at) && now - at > RESEND_OLD_DAYS * 86_400_000;
}

/** Слова «не прошло» относятся к фото с этим временем (см. PAY_FAILED_NEAR_MS). */
export function failedNearPhoto(saidAt: string | null | undefined, photoAt: number): boolean {
  const at = Date.parse(String(saidAt ?? ""));
  return Number.isFinite(at) && at >= photoAt - PAY_FAILED_NEAR_MS;
}
