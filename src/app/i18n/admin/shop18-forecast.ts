import type { SectionDict } from "../section";

/** Прогноз склада (С6): «хватит на N дней» в списке товаров. */
export const ru = {
  "products.col.daysLeft": "Хватит на",
  "products.daysLeft": "{n} дн.",
  "products.daysLeftHint":
    "Остаток, делённый на средние продажи за 30 дней (отменённые заказы не считаются). «—» — продаж не было.",
};

export const kk: SectionDict<typeof ru> = {
  "products.col.daysLeft": "Жетеді",
  "products.daysLeft": "{n} күн",
  "products.daysLeftHint":
    "Қалдықты соңғы 30 күндегі орташа сатылымға бөлгенде шығатын мән (бас тартылған тапсырыстар есептелмейді). «—» — сатылым болмаған.",
};

export const en: SectionDict<typeof ru> = {
  "products.col.daysLeft": "Lasts for",
  "products.daysLeft": "{n} d",
  "products.daysLeftHint":
    "Stock divided by average daily sales over 30 days (cancelled orders are not counted). “—” means no sales.",
};

export const uz: SectionDict<typeof ru> = {
  "products.col.daysLeft": "Yetadi",
  "products.daysLeft": "{n} kun",
  "products.daysLeftHint":
    "Qoldiqni soʻnggi 30 kundagi oʻrtacha savdoga boʻlish natijasi (bekor qilingan buyurtmalar hisobga olinmaydi). «—» — savdo boʻlmagan.",
};
