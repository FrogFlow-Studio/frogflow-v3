import type { Locale } from "@/core/i18n/locale";

/** Кнопка «Заказать снова» в «Мои заказы» площадки (К3) на 4 языках. Пояснения под ней — строки витрины. */
const ru = {
  button: "Заказать снова",
  failed: "Не получилось. Попробуйте ещё раз или откройте заказ в магазине.",
} as const;
type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  button: "Қайта тапсырыс беру",
  failed: "Болмады. Қайталап көріңіз немесе тапсырысты дүкеннен ашыңыз.",
};
const en: Record<Key, string> = {
  button: "Order again",
  failed: "That did not work. Try again or open the order in the shop.",
};
const uz: Record<Key, string> = {
  button: "Qayta buyurtma berish",
  failed: "Bajarilmadi. Qayta urinib koʻring yoki buyurtmani doʻkonda oching.",
};

const DICTS: Record<Locale, Record<Key, string>> = { ru, kk, en, uz };

export const REORDER_KEYS = Object.keys(ru) as Key[];
export const reorderT = (locale: Locale) => (key: Key) => (DICTS[locale] ?? ru)[key];
