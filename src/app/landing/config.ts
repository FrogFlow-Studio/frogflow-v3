/**
 * Данные главной, которые меняет владелец платформы: тарифы, клиенты,
 * контакты, демо. Тексты — в `src/app/i18n/landing.ts`. Пустое значение
 * прячет свой блок, так что страница не показывает заглушек.
 */
import type { Locale } from "@/core/i18n/locale";

export type PlanKey = "basic" | "pro" | "business";

/** Абонентская плата в месяц, ₸. */
export const PLAN_PRICES: Record<PlanKey, number> = {
  basic: 9900,
  pro: 19900,
  business: 39900,
};

/** Разовое подключение «от», ₸. */
export const SETUP_FEE_FROM = 15000;

/** Пробный период, дней. */
export const TRIAL_DAYS = 14;

/** Тариф, который выделяется на странице. */
export const FEATURED_PLAN: PlanKey = "pro";

export type LandingClient = {
  name: string;
  /** Чем занимается, на каждом языке главной; цифры — после « · », рисуются отдельной строкой. */
  note: Record<Locale, string>;
  /** Ссылка на основного бота магазина (не VIP); нет — имя без ссылки. */
  url?: string;
};

export const CLIENTS: LandingClient[] = [
  {
    name: "AATeach",
    url: "https://t.me/maga21zzzbot",
    note: {
      ru: "дидактика для педагогов · 450+ товаров, 1 100+ заказов",
      kk: "педагогтерге арналған дидактика · 450+ тауар, 1 100+ тапсырыс",
      en: "teaching materials · 450+ products, 1,100+ orders",
      uz: "o‘qituvchilar uchun didaktika · 450+ mahsulot, 1 100+ buyurtma",
    },
  },
  {
    name: "Развивашка",
    url: "https://t.me/razvivashka_kaz_bot",
    note: {
      ru: "развивающие материалы, магазин и VIP-бот · 180+ VIP-подписчиков, 370+ покупателей",
      kk: "дамытушы материалдар, дүкен және VIP-бот · 180+ VIP-жазылушы, 370+ сатып алушы",
      en: "early learning materials, shop and VIP bot · 180+ VIP subscribers, 370+ customers",
      uz: "rivojlantiruvchi materiallar, do‘kon va VIP-bot · 180+ VIP-obunachi, 370+ xaridor",
    },
  },
  {
    name: "Дидактика 03",
    url: "https://t.me/didaktika_03_bot",
    note: {
      ru: "магазин материалов и VIP-бот · 120+ заказов, 650+ покупателей",
      kk: "материалдар дүкені және VIP-бот · 120+ тапсырыс, 650+ сатып алушы",
      en: "materials shop and VIP bot · 120+ orders, 650+ customers",
      uz: "materiallar do‘koni va VIP-bot · 120+ buyurtma, 650+ xaridor",
    },
  },
  {
    name: "BOVI",
    note: {
      ru: "домашний текстиль, консультант в Instagram",
      kk: "үй тоқыма бұйымдары, Instagram-дағы кеңесші",
      en: "home textiles, Instagram consultant",
      uz: "uy to‘qimachiligi, Instagram maslahatchisi",
    },
  },
];

export type LandingReview = {
  author: string;
  shop: string;
  text: Record<Locale, string>;
};

/** Отзывы продавцов. Пусто — блок отзывов не показывается. */
export const REVIEWS: LandingReview[] = [];

/** Контакты платформы. null — строка не показывается, оба null — блок связи скрыт. */
export const CONTACTS: { telegram: string | null; whatsapp: string | null } = {
  /** Имя в Telegram без @. */
  telegram: "Frog1f_1",
  /** Номер WhatsApp только цифрами, с кодом страны: 77001234567. */
  whatsapp: "77005102751",
};

/** Ссылка на демо-бота. null — кнопка «Попробовать демо» не показывается. */
export const DEMO_URL: string | null = "https://t.me/maga21zzzbot";

const NBSP = String.fromCharCode(0xa0);

/** 9900 → «9 900 ₸» (пробелы неразрывные), одинаково на сервере и в браузере. */
export function formatTenge(n: number): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₸`;
}
