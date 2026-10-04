import type { SectionDict } from "../section";

/** Список заказов на телефоне: карточки, жест «потянуть — обновить» (А3). */
export const ru = {
  "orders.pull": "Потяните вниз, чтобы обновить",
  "orders.pullRelease": "Отпустите, чтобы обновить",
  "orders.refreshing": "Обновляем…",
  "orders.filtersLabel": "Фильтр по статусу",
} as const;

export const kk: SectionDict<typeof ru> = {
  "orders.pull": "Жаңарту үшін төмен тартыңыз",
  "orders.pullRelease": "Жаңарту үшін жіберіңіз",
  "orders.refreshing": "Жаңартып жатырмыз…",
  "orders.filtersLabel": "Күйі бойынша сүзгі",
};

export const en: SectionDict<typeof ru> = {
  "orders.pull": "Pull down to refresh",
  "orders.pullRelease": "Release to refresh",
  "orders.refreshing": "Refreshing…",
  "orders.filtersLabel": "Filter by status",
};

export const uz: SectionDict<typeof ru> = {
  "orders.pull": "Yangilash uchun pastga torting",
  "orders.pullRelease": "Yangilash uchun qo‘yib yuboring",
  "orders.refreshing": "Yangilanmoqda…",
  "orders.filtersLabel": "Holat bo‘yicha filtr",
};
