/** Согласие, отказ и отмена. */

const AFFIRMATIVES = new Set([
  "да",
  "да!",
  "ага",
  "угу",
  "хочу",
  "хочу!",
  "интересно",
  "интересует",
  "давайте",
  "давай",
  "+",
  "ок",
  "окей",
  "ok",
  "yes",
  "нужно",
  "надо",
]);

/** Односложное согласие — ответ воронке, а не поисковый запрос. */
export function isAffirmative(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return AFFIRMATIVES.has(normalized) || AFFIRMATIVES.has(`${normalized}!`);
}

const DISMISSALS = new Set([
  "нет",
  "не",
  "не нужно",
  "ненужно",
  "не надо",
  "ненадо",
  "не хочу",
  "неинтересно",
  "не интересно",
  "спасибо",
  "спс",
  "благодарю",
  "понятно",
  "понял",
  "поняла",
  "хорошо",
  "ясно",
  "всё",
  "все",
  "пока",
  "до свидания",
  "-",
]);

/** «Не нужно», «спасибо», «понятно» — разговор закрыт, а не начат заново. */
export function isDismissal(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!)»"]+$/g, "")
    .replace(/\s+/g, " ");
  return DISMISSALS.has(normalized);
}

const CANCEL_WORDS = new Set([
  "отмена",
  "отменить",
  "отмени",
  "отмените",
  "стоп",
  "сброс",
  "сбросить",
  "заново",
  "начать заново",
  "/start",
  "/stop",
  "/cancel",
  "хватит",
  "cancel",
  "болдырмау",
  "bekor",
  "bekor qilish",
]);

/**
 * Естественные фразы отмены заказа или сценария:
 * «отмените покупку», «ладно. отмените заказ», «передумал», «не хочу покупать».
 * Не является отменой, если это вопрос («отменяется ли заказ?», «а если отмена?»).
 */
const CANCEL_PHRASE =
  /^(?:ладно[.,\s]+|ну[.,\s]+|хорошо[.,\s]+|давайте[.,\s]+|давай[.,\s]+|я[.,\s]+)?(?:отмен(?:а|и|ить|ите|им)|сброс(?:ить)?|стоп|хватит|передумал(?:а)?|не буду (?:брать|покупать)|не хочу покупать)(?:\s+(?:покупку|заказ|вс[её])(?:\s*#?\d+)?)?(?:\s*,?\s*пожалуйста)?[.!]?$/i;

/** Выход из сценария — работает на любом шаге, иначе на выборе страны можно запереться. */
export function isCancel(text: string): boolean {
  if (text.includes("?") || /\bли\b/i.test(text)) return false;
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ");
  if (CANCEL_WORDS.has(normalized)) return true;
  return CANCEL_PHRASE.test(normalized);
}
