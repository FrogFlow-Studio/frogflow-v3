import type { SectionDict } from "../section";

/** Карточка заказа: вкладки на телефоне (А4). */
export const ru = {
  "order.tabOrder": "Заказ",
  "order.tabHistory": "История",
} as const;
export const kk: SectionDict<typeof ru> = {
  "order.tabOrder": "Тапсырыс",
  "order.tabHistory": "Тарих",
};
export const en: SectionDict<typeof ru> = {
  "order.tabOrder": "Order",
  "order.tabHistory": "History",
};
export const uz: SectionDict<typeof ru> = {
  "order.tabOrder": "Buyurtma",
  "order.tabHistory": "Tarix",
};
