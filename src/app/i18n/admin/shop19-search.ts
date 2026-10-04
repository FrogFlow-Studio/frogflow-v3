import type { SectionDict } from "../section";

/** Быстрый поиск админки: разделы, «все по запросу», кнопка на телефоне (А8). */
export const ru = {
  "palette.section": "раздел",
  "palette.allOrders": "Все заказы по запросу",
  "palette.allCustomers": "Все покупатели по запросу",
  "palette.allProducts": "Все товары по запросу",
  "palette.open": "Поиск",
  "palette.title": "Быстрый поиск",
  "palette.failed": "Поиск не удался. Повторите запрос.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "palette.section": "бөлім",
  "palette.allOrders": "Сұрау бойынша барлық тапсырыс",
  "palette.allCustomers": "Сұрау бойынша барлық сатып алушы",
  "palette.allProducts": "Сұрау бойынша барлық тауар",
  "palette.open": "Іздеу",
  "palette.title": "Жылдам іздеу",
  "palette.failed": "Іздеу сәтсіз аяқталды. Сұрауды қайталаңыз.",
};

export const en: SectionDict<typeof ru> = {
  "palette.section": "section",
  "palette.allOrders": "All orders for this search",
  "palette.allCustomers": "All buyers for this search",
  "palette.allProducts": "All products for this search",
  "palette.open": "Search",
  "palette.title": "Quick search",
  "palette.failed": "Search failed. Try again.",
};

export const uz: SectionDict<typeof ru> = {
  "palette.section": "boʻlim",
  "palette.allOrders": "Soʻrov boʻyicha barcha buyurtmalar",
  "palette.allCustomers": "Soʻrov boʻyicha barcha xaridorlar",
  "palette.allProducts": "Soʻrov boʻyicha barcha mahsulotlar",
  "palette.open": "Qidiruv",
  "palette.title": "Tezkor qidiruv",
  "palette.failed": "Qidiruv amalga oshmadi. Qaytadan urinib koʻring.",
};
