/**
 * Данные главной, которые меняет владелец платформы: тарифы, клиенты,
 * контакты, демо. Тексты — в `src/app/i18n/landing.ts`. Пустое значение
 * прячет свой блок, так что страница не показывает заглушек.
 */
import type { LandingKey } from "@/app/i18n/landing";
import type { Locale } from "@/core/i18n/locale";
import { moduleDef, type ModuleKey } from "@/core/modules/registry";
import { planModules } from "@/core/plans/plans";
import {
  ADDON_MONTHLY_PRICE,
  ANNUAL_BILLED_MONTHS,
  CONNECTION_PRICE,
  MONTHLY_PRICE,
  PLAN_TIERS,
  type PlanNiche,
} from "@/core/plans/registry";

export type PlanKey = "basic" | "pro" | "business";

/** Абонентская плата в месяц, ₸: та же, что выставляет оператор (`core/plans/registry`). */
export const PLAN_PRICES: Record<PlanKey, number> = MONTHLY_PRICE;

/** Разовое подключение по тарифам, ₸ — тоже из реестра. */
export const SETUP_FEES: Record<PlanKey, number> = CONNECTION_PRICE;

/** Сколько месяцев в подарок при оплате за год (реестр: платится ANNUAL_BILLED_MONTHS из 12). */
export const ANNUAL_FREE_MONTHS = 12 - ANNUAL_BILLED_MONTHS;

/** Канал сверх тарифа, ₸ в месяц: самая низкая из надбавок (сейчас у всех каналов одна). */
export const ADDON_PRICE = Math.min(...Object.values(ADDON_MONTHLY_PRICE));

/** Пробный период, дней: тот же, что выдаёт оператор (`core/plans/registry`). */
export { TRIAL_DAYS } from "@/core/plans/registry";

/** Ниши на вкладках тарифов главной и их планы в реестре. */
/** `school` — тарифы школы; вкладки на главной их не показывают, они только на /for/courses. */
export type PricingNiche = "dig" | "cake" | "flow" | "ai" | "school";
export const PLAN_NICHE: Record<PricingNiche, PlanNiche> = {
  dig: "digital",
  school: "courses",
  cake: "confectionery",
  flow: "flowers",
  ai: "consultant_universal",
};

/**
 * Модули, у которых на главной своя строка в тарифе. Строка стоит в самом
 * младшем тарифе ниши, план которого включает модуль (core/plans), и только
 * когда модуль готов: «в разработке» на главной не показывается. Старшие
 * тарифы получают его через «Всё из …». Так главная следует реестру сама.
 */
export const LANDING_MODULE_LINES = {
  courses: "pricing.courses",
  crm_pipeline: "pricing.crm",
  helpdesk: "pricing.helpdesk",
  multi_bot: "pricing.multiBot",
} as const satisfies Partial<Record<ModuleKey, LandingKey>>;

/** С какого тарифа ниши модуль входит в план; null — ни в один или не готов. */
export function moduleFromTier(niche: PricingNiche, m: ModuleKey): PlanKey | null {
  if (moduleDef(m).status !== "available") return null;
  return PLAN_TIERS.find((t) => planModules(PLAN_NICHE[niche], t).has(m)) ?? null;
}

/**
 * Что входит в план ниши: у Basic четыре пункта, у старших — «всё из
 * младшего» и три своих; ниже — строки модулей, которые входят с этого тарифа.
 */
export function planFeatureKeys(niche: PricingNiche, plan: PlanKey): LandingKey[] {
  const own = (n: number) =>
    Array.from({ length: n }, (_, i) => `pricing.${niche}.${plan}.f${i + 1}` as LandingKey);
  const keys: LandingKey[] =
    plan === "basic" ? own(4) : [plan === "pro" ? "pricing.allBasic" : "pricing.allPro", ...own(3)];
  for (const [m, key] of Object.entries(LANDING_MODULE_LINES) as Array<[ModuleKey, LandingKey]>)
    if (moduleFromTier(niche, m) === plan) keys.push(key);
  return keys;
}

/** Тариф, который выделяется на странице. */
export const FEATURED_PLAN: PlanKey = "pro";

export type LandingClient = {
  name: string;
  /** Чем занимается, на каждом языке главной; цифры — после « · », рисуются отдельной строкой. */
  note: Record<Locale, string>;
  /** Ссылка на основного бота магазина (не VIP); нет — имя без ссылки. */
  url?: string;
  /** Главная цифра крупно с подписью; нет — подпись «Новый запуск». В `note` её не повторять. */
  stat?: { value: string; label: Record<Locale, string> };
};

/**
 * Клиенты на главной. Цифры — из базы платформы (заказы со статусом «выдан»,
 * покупатели бота) на дату `CLIENTS_AS_OF`; обновлять вместе с датой.
 */
export const CLIENTS: LandingClient[] = [
  {
    name: "AATeach",
    stat: {
      value: "2 300+",
      label: { ru: "заказов", kk: "тапсырыс", en: "orders", uz: "buyurtma" },
    },
    url: "https://t.me/maga21zzzbot",
    note: {
      ru: "дидактика для педагогов · Telegram-бот, 560+ товаров",
      kk: "педагогтерге арналған дидактика · Telegram-бот, 560+ тауар",
      en: "teaching materials · Telegram bot, 560+ products",
      uz: "o‘qituvchilar uchun didaktika · Telegram-bot, 560+ mahsulot",
    },
  },
  {
    name: "BOVI",
    stat: {
      value: "590+",
      label: {
        ru: "покупателей в Direct",
        kk: "Direct-тегі сатып алушы",
        en: "customers in Direct",
        uz: "Direct’dagi xaridor",
      },
    },
    note: {
      ru: "домашний текстиль · ИИ-консультант в Instagram",
      kk: "үй тоқыма бұйымдары · Instagram-дағы ЖИ-кеңесші",
      en: "home textiles · AI consultant in Instagram",
      uz: "uy to‘qimachiligi · Instagram’dagi AI-maslahatchi",
    },
  },
  {
    name: "Дидактика 03",
    stat: {
      value: "130+",
      label: { ru: "заказов", kk: "тапсырыс", en: "orders", uz: "buyurtma" },
    },
    url: "https://t.me/didaktika_03_bot",
    note: {
      ru: "магазин материалов и VIP-бот · 890+ покупателей",
      kk: "материалдар дүкені және VIP-бот · 890+ сатып алушы",
      en: "materials shop and VIP bot · 890+ customers",
      uz: "materiallar do‘koni va VIP-bot · 890+ xaridor",
    },
  },
  {
    name: "Копилка Русоведа",
    stat: {
      value: "50+",
      label: { ru: "заказов", kk: "тапсырыс", en: "orders", uz: "buyurtma" },
    },
    note: {
      ru: "материалы для учителей русского языка · 530+ покупателей",
      kk: "орыс тілі мұғалімдеріне материалдар · 530+ сатып алушы",
      en: "materials for Russian language teachers · 530+ customers",
      uz: "rus tili o‘qituvchilari uchun materiallar · 530+ xaridor",
    },
  },
  {
    name: "Lash Academy Bishkek",
    note: {
      ru: "онлайн-курс по наращиванию ресниц · Кыргызстан, оплата переводом на карту",
      kk: "кірпік жапсыру онлайн-курсы · Қырғызстан, картаға аударым арқылы төлем",
      en: "online lash extension course · Kyrgyzstan, card transfer payments",
      uz: "kiprik uzaytirish onlayn-kursi · Qirg‘iziston, kartaga o‘tkazma orqali to‘lov",
    },
  },
];

/** Дата цифр в `CLIENTS` и `PLATFORM_ORDERS`, ДД.ММ.ГГГГ. */
export const CLIENTS_AS_OF = "27.11.2026";

/** Заказов выдано покупателям через платформу (все клиенты, без тестовых магазинов). */
export const PLATFORM_ORDERS = "2 500+";

/** Контакты платформы. null — строка не показывается, оба null — блок связи скрыт. */
export const CONTACTS: { telegram: string | null; whatsapp: string | null } = {
  /** Имя в Telegram без @. */
  telegram: "Frog1f_1",
  /** Номер WhatsApp только цифрами, с кодом страны: 77001234567. */
  whatsapp: "77005102751",
};

/** Адрес главной без хвостового слэша: canonical, og:url и языковые версии. */
export const SITE_URL = "https://www.frogflow.tech";

/** Язык страницы для превью ссылок (og:locale). */
export const OG_LOCALE: Record<Locale, string> = {
  ru: "ru_RU",
  kk: "kk_KZ",
  en: "en_US",
  uz: "uz_UZ",
};

/**
 * Картинка превью ссылки (public/og.png, 1200×630): без неё Telegram, WhatsApp
 * и поисковики показывают ссылку на платформу голым текстом.
 */
export const OG_IMAGE_META = [
  { property: "og:image", content: `${SITE_URL}/og.png` },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { name: "twitter:card", content: "summary_large_image" },
];

/** Адрес главной на языке: русский — без параметра, остальные — `?lang=`. */
export function landingUrl(locale: Locale): string {
  return locale === "ru" ? `${SITE_URL}/` : `${SITE_URL}/?lang=${locale}`;
}

/** Ссылка на демо-бота. null — кнопка «Попробовать демо» не показывается. */
export const DEMO_URL: string | null = "https://t.me/demtest12_bot";

const NBSP = String.fromCharCode(0xa0);

/** 9900 → «9 900 ₸» (пробелы неразрывные), одинаково на сервере и в браузере. */
export function formatTenge(n: number): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}₸`;
}
