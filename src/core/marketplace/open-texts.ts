import type { Locale } from "@/core/i18n/locale";

/**
 * Готовое сообщение заявителю после создания магазина (В19). Оператор отправляет его сам
 * тем способом, которым с ним удобно связаться (телефон, почта, Instagram): бот магазина
 * появится, когда владелец вставит токен Telegram-бота в настройках.
 */
export type WelcomeVars = {
  name: string;
  shopUrl: string;
  adminUrl: string;
  login: string;
  password: string;
};

const TEXTS: Record<Locale, (v: WelcomeVars) => string> = {
  ru: (v) =>
    `Здравствуйте! Магазин «${v.name}» создан на FrogFlow.\n\nАдминка: ${v.adminUrl}\nЛогин: ${v.login}\nПароль: ${v.password}\n\nВитрина: ${v.shopUrl}\n\nЗайдите в админку и смените пароль в настройках. Бота в Telegram подключите там же: вставьте токен от @BotFather. Если нужна помощь, напишите нам.`,
  kk: (v) =>
    `Сәлеметсіз бе! «${v.name}» дүкені FrogFlow-та жасалды.\n\nӘкімшілік: ${v.adminUrl}\nЛогин: ${v.login}\nҚұпиясөз: ${v.password}\n\nВитрина: ${v.shopUrl}\n\nӘкімшілікке кіріп, баптауларда құпиясөзді ауыстырыңыз. Telegram ботын сол жерде қосыңыз: @BotFather берген токенді енгізіңіз. Көмек керек болса, бізге жазыңыз.`,
  en: (v) =>
    `Hello! Your shop "${v.name}" is ready on FrogFlow.\n\nAdmin panel: ${v.adminUrl}\nLogin: ${v.login}\nPassword: ${v.password}\n\nStorefront: ${v.shopUrl}\n\nPlease sign in and change the password in settings. Connect your Telegram bot there too: paste the token from @BotFather. If you need help, just write to us.`,
  uz: (v) =>
    `Assalomu alaykum! «${v.name}» do‘koni FrogFlow’da yaratildi.\n\nAdmin panel: ${v.adminUrl}\nLogin: ${v.login}\nParol: ${v.password}\n\nVitrina: ${v.shopUrl}\n\nPanelga kirib, sozlamalarda parolni almashtiring. Telegram botni ham shu yerda ulang: @BotFather bergan tokenni kiriting. Yordam kerak bo‘lsa, bizga yozing.`,
};

export const welcomeText = (locale: Locale, v: WelcomeVars): string =>
  (TEXTS[locale] ?? TEXTS.ru)(v);
