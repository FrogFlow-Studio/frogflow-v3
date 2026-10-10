/**
 * Разбор реплик покупателя в Instagram Direct и WhatsApp — без побочных
 * действий, чтобы проверять тестом. Перенос `direct-flow.ts` v1 по описи
 * (docs/inherited-knowledge.md): что считать номером товара, выбором страны,
 * командой, отказом и жалобой на оплату. Ошибка в любом из этих решений
 * выглядит одинаково — «бот тупит», — а чинится в разных местах.
 * Реализация — в `./flow/`.
 */
export {
  extractPhoneDigits,
  extractProductNumber,
  extractNumberList,
  taggedProductNumber,
  taggedKeyword,
  productNumberFromName,
  productNumberFromKeywords,
  parseRemoveCommand,
  pickCartLineToRemove,
  matchOrdinal,
  matchLocalePick,
} from "./flow/numbers";
export {
  languagePickerText,
  STEP_TTL_MS,
  isStepStale,
  PRODUCT_LIST_HINT,
  ONE_SECTION_HINT,
  cartCardText,
  MULTI_ADD_COPY,
  LOCALE_PICK_ECHO_MS,
  isLocalePickEcho,
} from "./flow/steps";
export { type CountryOption, matchCountry, type ZoneOption, matchZone } from "./flow/places";
export { pickReceiptAttachment, emailStep, extractEmail } from "./flow/receipt-email";
export { isAffirmative, isDismissal, isCancel } from "./flow/replies";
export { type DirectCommand, matchDirectCommand } from "./flow/commands";
export {
  isPaymentComplaint,
  isPayTrouble,
  isReceiptHowQuestion,
  type IncomingKind,
  classifyIncoming,
  plain,
  matchLoyaltyPointsChoice,
  matchDeliveryLangChoice,
} from "./flow/classify";
export {
  STEP_PREFIX,
  WA_LIST_MAX_ROWS,
  WA_LIST_PAGE,
  type WhatsAppListRow,
  type WhatsAppListSection,
  stepAnswer,
  clipRowTitle,
  rowSubtitle,
  whatsappList,
} from "./flow/whatsapp-list";
