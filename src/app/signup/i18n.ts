import type { Locale } from "@/core/i18n/locale";
import { fill, type UserErrorVars } from "@/core/i18n/user-error";
import { CHALLENGE_TOO_FAST, REFRESH } from "./challenge";
import {
  SIGNUP_CLOSED,
  SIGNUP_UNAVAILABLE,
  SIGNUP_USERNAME_RULE,
  addressTakenText,
  idTakenText,
  loginTakenText,
} from "./refusals";
import { errorMessage } from "@/lib/error-message";

/**
 * Страница регистрации `/signup` и отказы её серверной части на 4 языках.
 * Русский — источник; сервер отдаёт русский текст (журналы, оператор), а
 * браузер подбирает перевод по этому тексту (`signupErrorText`).
 */
const ru = {
  "meta.title": "FrogFlow · Регистрация",
  "closed.title": "Регистрация закрыта",
  "closed.text": "Подключение магазинов сейчас идёт через оператора.",
  "form.title": "Открыть магазин",
  "form.lead":
    "Две минуты: название, логин и пароль. Бота в Telegram подключите следующим шагом — панель подскажет, что делать.",
  "form.name": "Название магазина",
  "form.namePlaceholder": "Материалы для педагога",
  "form.vertical": "Что продаёте",
  "form.username": "Логин",
  "form.usernameHint": "Латиница и цифры. Станет адресом магазина: /s/<логин>.",
  "form.password": "Пароль",
  "form.passwordHint": "Не короче 8 символов.",
  "form.contact": "Как с вами связаться",
  "form.contactHint": "Телефон или @username, необязательно.",
  "form.submit": "Создать магазин",
  "form.busy": "Создаём магазин…",
  "form.haveShop": "Уже есть магазин?",
  "form.login": "Войти",
  "vertical.digital": "Цифровые материалы",
  "vertical.confectionery": "Кондитерская",
  "vertical.flowers": "Цветы и букеты",
  "vertical.courses": "Онлайн-школа",
  "err.refresh": REFRESH,
  "err.tooFast": CHALLENGE_TOO_FAST,
  "err.ip": "С этого адреса уже зарегистрированы магазины. Попробуйте завтра или напишите нам.",
  "err.total": "Регистрация на сегодня временно закрыта. Попробуйте завтра или напишите нам.",
  "err.closed": SIGNUP_CLOSED,
  "err.unavailable": SIGNUP_UNAVAILABLE,
  "err.username": SIGNUP_USERNAME_RULE,
  "err.idTaken": idTakenText("{v}"),
  "err.loginTaken": loginTakenText("{v}"),
  "err.addressTaken": addressTakenText("{v}"),
};

type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  "meta.title": "FrogFlow · Тіркелу",
  "closed.title": "Тіркелу жабық",
  "closed.text": "Дүкендерді қосу қазір оператор арқылы жүріп жатыр.",
  "form.title": "Дүкен ашу",
  "form.lead":
    "Екі минут: атауы, логин және құпиясөз. Telegram ботын келесі қадамда қосасыз — панель не істеу керегін айтады.",
  "form.name": "Дүкен атауы",
  "form.namePlaceholder": "Педагогқа арналған материалдар",
  "form.vertical": "Не сатасыз",
  "form.username": "Логин",
  "form.usernameHint": "Латын әріптері мен сандар. Дүкен мекенжайы болады: /s/<логин>.",
  "form.password": "Құпиясөз",
  "form.passwordHint": "Кемінде 8 таңба.",
  "form.contact": "Сізбен қалай байланысамыз",
  "form.contactHint": "Телефон немесе @username, міндетті емес.",
  "form.submit": "Дүкен жасау",
  "form.busy": "Дүкен жасалып жатыр…",
  "form.haveShop": "Дүкеніңіз бар ма?",
  "form.login": "Кіру",
  "vertical.digital": "Цифрлық материалдар",
  "vertical.confectionery": "Кондитерлік",
  "vertical.flowers": "Гүлдер мен букеттер",
  "vertical.courses": "Онлайн-мектеп",
  "err.refresh": "Тексеру ескірді — бетті жаңартып, қайта көріңіз.",
  "err.tooFast": "Тым жылдам — өрістерді тексеріп, қайта жіберіңіз.",
  "err.ip": "Бұл мекенжайдан дүкендер тіркелген. Ертең көріңіз немесе бізге жазыңыз.",
  "err.total": "Бүгінге тіркелу уақытша жабық. Ертең көріңіз немесе бізге жазыңыз.",
  "err.closed": "Тіркелу жабық — операторға хабарласыңыз.",
  "err.unavailable": "Тіркелу уақытша қолжетімсіз. Кейінірек көріңіз.",
  "err.username": "Логин: латын әріптері, сандар, нүкте, дефис",
  "err.idTaken": "«{v}» идентификаторы бос емес.",
  "err.loginTaken": "«{v}» логині қолданылып жатыр.",
  "err.addressTaken": "«{v}» мекенжайы бос емес — басқа логин таңдаңыз.",
};

const en: Record<Key, string> = {
  "meta.title": "FrogFlow · Sign up",
  "closed.title": "Sign-up is closed",
  "closed.text": "Shops are being connected through an operator for now.",
  "form.title": "Open a shop",
  "form.lead":
    "Two minutes: a name, a login and a password. Connect your Telegram bot as the next step — the panel will show you how.",
  "form.name": "Shop name",
  "form.namePlaceholder": "Materials for teachers",
  "form.vertical": "What you sell",
  "form.username": "Login",
  "form.usernameHint": "Latin letters and digits. It becomes your shop address: /s/<login>.",
  "form.password": "Password",
  "form.passwordHint": "At least 8 characters.",
  "form.contact": "How to reach you",
  "form.contactHint": "Phone or @username, optional.",
  "form.submit": "Create shop",
  "form.busy": "Creating your shop…",
  "form.haveShop": "Already have a shop?",
  "form.login": "Log in",
  "vertical.digital": "Digital materials",
  "vertical.confectionery": "Bakery",
  "vertical.flowers": "Flowers and bouquets",
  "vertical.courses": "Online school",
  "err.refresh": "The check has expired — refresh the page and try again.",
  "err.tooFast": "Too fast — check the fields and submit again.",
  "err.ip":
    "Shops have already been registered from this address. Try again tomorrow or write to us.",
  "err.total": "Sign-up is temporarily closed for today. Try again tomorrow or write to us.",
  "err.closed": "Sign-up is closed — please contact the operator.",
  "err.unavailable": "Sign-up is temporarily unavailable. Please try again later.",
  "err.username": "Login: Latin letters, digits, dot, hyphen",
  "err.idTaken": "The identifier “{v}” is already taken.",
  "err.loginTaken": "The login “{v}” is already in use.",
  "err.addressTaken": "The address “{v}” is already taken — choose another login.",
};

const uz: Record<Key, string> = {
  "meta.title": "FrogFlow · Ro‘yxatdan o‘tish",
  "closed.title": "Ro‘yxatdan o‘tish yopiq",
  "closed.text": "Do‘konlar hozircha operator orqali ulanmoqda.",
  "form.title": "Do‘kon ochish",
  "form.lead":
    "Ikki daqiqa: nom, login va parol. Telegram botni keyingi qadamda ulaysiz — panel nima qilishni aytadi.",
  "form.name": "Do‘kon nomi",
  "form.namePlaceholder": "O‘qituvchilar uchun materiallar",
  "form.vertical": "Nima sotasiz",
  "form.username": "Login",
  "form.usernameHint": "Lotin harflari va raqamlar. Do‘kon manzili bo‘ladi: /s/<login>.",
  "form.password": "Parol",
  "form.passwordHint": "Kamida 8 ta belgi.",
  "form.contact": "Siz bilan qanday bog‘lanamiz",
  "form.contactHint": "Telefon yoki @username, majburiy emas.",
  "form.submit": "Do‘kon yaratish",
  "form.busy": "Do‘kon yaratilmoqda…",
  "form.haveShop": "Do‘koningiz bormi?",
  "form.login": "Kirish",
  "vertical.digital": "Raqamli materiallar",
  "vertical.confectionery": "Qandolatxona",
  "vertical.flowers": "Gullar va buketlar",
  "vertical.courses": "Onlayn maktab",
  "err.refresh": "Tekshiruv eskirdi — sahifani yangilab, qayta urinib ko‘ring.",
  "err.tooFast": "Juda tez — maydonlarni tekshirib, qayta yuboring.",
  "err.ip": "Bu manzildan do‘konlar ro‘yxatdan o‘tgan. Ertaga urinib ko‘ring yoki bizga yozing.",
  "err.total": "Bugun ro‘yxatdan o‘tish vaqtincha yopiq. Ertaga urinib ko‘ring yoki bizga yozing.",
  "err.closed": "Ro‘yxatdan o‘tish yopiq — operatorga murojaat qiling.",
  "err.unavailable": "Ro‘yxatdan o‘tish vaqtincha mavjud emas. Keyinroq urinib ko‘ring.",
  "err.username": "Login: lotin harflari, raqamlar, nuqta, defis",
  "err.idTaken": "«{v}» identifikatori band.",
  "err.loginTaken": "«{v}» logini allaqachon ishlatilmoqda.",
  "err.addressTaken": "«{v}» manzili band — boshqa login tanlang.",
};

export const SIGNUP_DICTS: Record<Locale, Record<Key, string>> = { ru, kk, en, uz };

export function signupT(locale: Locale) {
  const d = SIGNUP_DICTS[locale];
  return (key: Key, vars?: UserErrorVars) => fill(d[key], vars);
}

/** Название ниши для списка; нет перевода — русское из реестра. */
export function signupVerticalTitle(locale: Locale, key: string, fallback: string): string {
  const k = `vertical.${key}` as Key;
  return k in ru ? SIGNUP_DICTS[locale][k] : fallback;
}

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Ошибка сервера регистрации на языке страницы: сервер отдаёт русский текст, перевод — по нему. */
export function signupErrorText(locale: Locale, e: unknown): string {
  const message = errorMessage(e);
  for (const k of Object.keys(ru) as Key[]) {
    if (!k.startsWith("err.")) continue;
    if (ru[k].includes("{v}")) {
      const m = new RegExp(`^${escape(ru[k]).replace("\\{v\\}", "(.+)")}$`).exec(message);
      if (m) return fill(SIGNUP_DICTS[locale][k], { v: m[1]! });
    } else if (message === ru[k] || (k === "err.username" && message.includes(ru[k])))
      return SIGNUP_DICTS[locale][k];
  }
  return message;
}
