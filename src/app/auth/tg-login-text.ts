import type { Locale } from "@/core/i18n/locale";

/** Сообщение со ссылкой «Войти через Telegram» — на языке магазина (сессии продавца ещё нет). */
const TEXT: Record<Locale, (link: string) => string> = {
  ru: (l) =>
    `🔐 Вход в панель магазина. Ссылка действует 10 минут и работает один раз:\n${l}\n\nЕсли входите не вы — не открывайте её.`,
  kk: (l) =>
    `🔐 Дүкен панеліне кіру. Сілтеме 10 минут жарамды және бір рет қана жұмыс істейді:\n${l}\n\nЕгер кіріп жатқан сіз болмасаңыз — оны ашпаңыз.`,
  en: (l) =>
    `🔐 Sign in to your shop panel. The link is valid for 10 minutes and works once:\n${l}\n\nIf this wasn't you, don't open it.`,
  uz: (l) =>
    `🔐 Do‘kon paneliga kirish. Havola 10 daqiqa amal qiladi va bir marta ishlaydi:\n${l}\n\nAgar kirayotgan siz bo‘lmasangiz — uni ochmang.`,
};

export function tgLoginMessage(locale: Locale, link: string): string {
  return TEXT[locale](link);
}
