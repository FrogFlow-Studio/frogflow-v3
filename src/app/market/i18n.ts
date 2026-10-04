import type { Locale } from "@/core/i18n/locale";
import { fill, type UserErrorVars } from "@/core/i18n/user-error";

/** Публичная площадка /market на 4 языках. Русский — источник ключей. */
const ru = {
  "meta.title": "Магазины на FrogFlow",
  "meta.description": "Каталог магазинов FrogFlow: найдите магазин по категории и городу.",
  title: "Магазины на FrogFlow",
  lead: "Магазины, которые согласились показываться на площадке. Откройте витрину и закажите.",
  "search.label": "Поиск по названию",
  "search.placeholder": "Название магазина",
  "search.button": "Найти",
  "filter.category": "Категория",
  "filter.city": "Город",
  "filter.all": "Все",
  "shop.open": "Открыть магазин",
  "rating.none": "Пока без оценок",
  "rating.count": "{rating} из 5, оценок: {count}",
  empty: "Магазинов по этим условиям нет.",
  next: "Показать ещё",
  first: "В начало",
  soon: "Площадка скоро заработает: раздел ещё не включён.",
  home: "На главную",
} as const;

type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  "meta.title": "FrogFlow дүкендері",
  "meta.description": "FrogFlow дүкендерінің каталогы: санат пен қала бойынша дүкен табыңыз.",
  title: "FrogFlow дүкендері",
  lead: "Алаңда көрінуге келіскен дүкендер. Витринаны ашып, тапсырыс беріңіз.",
  "search.label": "Атауы бойынша іздеу",
  "search.placeholder": "Дүкен атауы",
  "search.button": "Іздеу",
  "filter.category": "Санат",
  "filter.city": "Қала",
  "filter.all": "Барлығы",
  "shop.open": "Дүкенді ашу",
  "rating.none": "Әзірге бағасыз",
  "rating.count": "5-тен {rating}, бағалар: {count}",
  empty: "Бұл шарттар бойынша дүкен жоқ.",
  next: "Тағы көрсету",
  first: "Басына",
  soon: "Алаң жақында іске қосылады: бөлім әлі қосылмаған.",
  home: "Басты бетке",
};

const en: Record<Key, string> = {
  "meta.title": "Shops on FrogFlow",
  "meta.description": "FrogFlow shop directory: find a shop by category and city.",
  title: "Shops on FrogFlow",
  lead: "Shops that agreed to be listed here. Open a storefront and place an order.",
  "search.label": "Search by name",
  "search.placeholder": "Shop name",
  "search.button": "Search",
  "filter.category": "Category",
  "filter.city": "City",
  "filter.all": "All",
  "shop.open": "Open shop",
  "rating.none": "No ratings yet",
  "rating.count": "{rating} out of 5, ratings: {count}",
  empty: "No shops match these filters.",
  next: "Show more",
  first: "Back to start",
  soon: "The marketplace is coming soon: this section is not switched on yet.",
  home: "Home",
};

const uz: Record<Key, string> = {
  "meta.title": "FrogFlow do‘konlari",
  "meta.description": "FrogFlow do‘konlari katalogi: toifa va shahar bo‘yicha do‘kon toping.",
  title: "FrogFlow do‘konlari",
  lead: "Maydonda ko‘rinishga rozi bo‘lgan do‘konlar. Vitrinani oching va buyurtma bering.",
  "search.label": "Nomi bo‘yicha qidirish",
  "search.placeholder": "Do‘kon nomi",
  "search.button": "Qidirish",
  "filter.category": "Toifa",
  "filter.city": "Shahar",
  "filter.all": "Hammasi",
  "shop.open": "Do‘konni ochish",
  "rating.none": "Hozircha baholarsiz",
  "rating.count": "5 dan {rating}, baholar: {count}",
  empty: "Bu shartlar bo‘yicha do‘kon yo‘q.",
  next: "Yana ko‘rsatish",
  first: "Boshiga",
  soon: "Maydon tez orada ishga tushadi: bo‘lim hali yoqilmagan.",
  home: "Bosh sahifa",
};

const DICTS: Record<Locale, Record<Key, string>> = { ru, kk, en, uz };

export type MarketKey = Key;
export const MARKET_KEYS = Object.keys(ru) as Key[];

export function marketT(locale: Locale) {
  const d = DICTS[locale] ?? ru;
  return (key: Key, vars?: UserErrorVars) => fill(d[key] ?? ru[key], vars);
}
