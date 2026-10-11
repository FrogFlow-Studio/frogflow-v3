/**
 * Спрашивать ли почту после чека в Instagram (Кристина, 10.10: «может с почтой
 * не стоит заморачиваться? удобно, когда материал сразу в инстаграм»).
 * Материалы и так приходят в переписку; выключено — бот почту не спрашивает,
 * а если покупатель сам попросит «на почту», адрес спросит ИИ после оплаты
 * (core/postpay).
 */
export const CHAT_EMAIL_ASK_KEY = "chat_email_ask";

/** Клиенты, у которых без настройки почту не спрашиваем: Копилка русоведа. */
export const EMAIL_ASK_DEFAULT_OFF: readonly string[] = ["4f9562e2-3bf4-4cba-8a58-794637511431"];

/** "true"/"false" — выбор продавца; без значения — по умолчанию клиента. */
export function emailAskOn(raw: string | null | undefined, botId: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return !EMAIL_ASK_DEFAULT_OFF.includes(botId);
}

/**
 * Почта по желанию (AATeach 11.10): на вопрос о почте покупатели отвечают
 * «Вацап отправте», «А в инстаграм можно?», а бот снова просил почту. Включено —
 * на такие ответы бот один раз говорит, что файлы придут в переписку, и больше
 * почту не спрашивает; адрес, если его всё же напишут, сохраняется.
 */
export const CHAT_EMAIL_OPTIONAL_KEY = "chat_email_optional";

/** "false" — продавец выключил; без значения — включено. */
export function emailOptionalOn(raw: string | null | undefined): boolean {
  return raw !== "false";
}

/** «Вацап», «сюда», «в инсту», «не надо почту»: покупатель хочет файлы не на почту. */
const NOT_EMAIL =
  /((ва|во)(т?с|т?ц)ап|whats\s*app|\bwa\b|сюда|здесь|тут|в\s*(инст|директ|direct|личк|лс(?!\p{L})|телеграм|тг(?!\p{L}))|инстаграм|instagram|директ|телеграм|не\s*(надо|нужн)\p{L}*|без\s*почт|нет\s*(почт|e-?mail|имейл)|не\s*(умею|знаю|помню)\p{L}*[^.!?]{0,20}почт|осында|мұнда|shu\s*yer|bu\s*yerga|here\b|no\s*email)/iu;

export function wantsFilesHere(text: string): boolean {
  return NOT_EMAIL.test(text);
}

/** Просьба именно о почте: «на почту», «email», «пошта», «pochta». */
const MAIL_WORDS = /(почт|e-?mail|имейл|емейл|мейл|пошта|pochta|\bmail\b|@)/iu;

export function mentionsEmail(text: string): boolean {
  return MAIL_WORDS.test(text);
}

/**
 * Похоже на адрес с опечаткой: без «@» («anna mail.ru», «annamail.ru»,
 * «anna собака mail ru») или без домена. Одно-два слова и почтовый домен.
 */
export function looksLikeEmailAttempt(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 60 || t.split(/\s+/).length > 4) return false;
  if (t.includes("@")) return true;
  return /(собака|mail|gmail|yandex|ya\.ru|inbox|bk\.ru|list\.ru|icloud|outlook|hotmail|yahoo|rambler)|\w\.(ru|com|kz|uz|by|net|org)\b/iu.test(
    t,
  );
}
