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
  "стоп",
  "сброс",
  "сбросить",
  "заново",
  "начать заново",
  "/start",
  "/stop",
  "хватит",
  "cancel",
  "болдырмау",
  "bekor",
  "bekor qilish",
]);

/** Выход из сценария — работает на любом шаге, иначе на выборе страны можно запереться. */
export function isCancel(text: string): boolean {
  return CANCEL_WORDS.has(
    text
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/, ""),
  );
}
