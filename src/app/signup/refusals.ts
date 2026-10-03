/**
 * Русские тексты отказов регистрации — один источник для сервера и для
 * перевода (`i18n.ts` подбирает язык страницы по этим же строкам): поменяли
 * текст здесь — перевод и тест идут за ним, а не отваливаются молча.
 */
export const SIGNUP_CLOSED = "Регистрация закрыта — обратитесь к оператору.";
export const SIGNUP_UNAVAILABLE = "Регистрация временно недоступна. Попробуйте позже.";
export const SIGNUP_USERNAME_RULE = "Логин: латиница, цифры, точка, дефис";
export const idTakenText = (id: string) => `Идентификатор «${id}» уже занят.`;
export const loginTakenText = (login: string) => `Логин «${login}» уже используется.`;
export const addressTakenText = (what: string) =>
  `Адрес «${what}» уже занят — выберите другой логин.`;
