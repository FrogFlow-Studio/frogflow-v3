import type { SectionDict } from "../section";

/** Заканчивается на складе (В3): порог магазина и товара. */
export const ru = {
  "settings.lowStock.title": "Заканчивается на складе",
  "settings.lowStock.intro":
    "Когда остаток товара падает до порога или ниже, вам приходит одно сообщение. Порог можно задать и в карточке товара.",
  "settings.lowStock.label": "Предупреждать, когда осталось не больше",
  "settings.lowStock.hint": "0 — не предупреждать. Считаются только товары с остатком.",
  "product.lowStock": "Предупредить, когда осталось не больше",
  "product.lowStockHint": "Пусто — порог магазина ({n}); 0 — не предупреждать.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "settings.lowStock.title": "Қоймада таусылып барады",
  "settings.lowStock.intro":
    "Тауар қалдығы шекке дейін немесе одан төмен түскенде сізге бір хабарлама келеді. Шекті тауар картасында да қоюға болады.",
  "settings.lowStock.label": "Қалдық мынадан аспағанда ескерту",
  "settings.lowStock.hint": "0 — ескертпеу. Тек қалдығы есептелетін тауарлар ескеріледі.",
  "product.lowStock": "Қалдық мынадан аспағанда ескерту",
  "product.lowStockHint": "Бос болса — дүкен шегі ({n}); 0 — ескертпеу.",
};

export const en: SectionDict<typeof ru> = {
  "settings.lowStock.title": "Running low on stock",
  "settings.lowStock.intro":
    "When a product's stock drops to the threshold or below, you get one message. A product can have its own threshold in its card.",
  "settings.lowStock.label": "Warn when no more than this is left",
  "settings.lowStock.hint": "0 — do not warn. Only products with tracked stock count.",
  "product.lowStock": "Warn when no more than this is left",
  "product.lowStockHint": "Empty — the shop threshold ({n}); 0 — do not warn.",
};

export const uz: SectionDict<typeof ru> = {
  "settings.lowStock.title": "Omborda tugab bormoqda",
  "settings.lowStock.intro":
    "Mahsulot qoldigʻi chegaraga yoki undan pastga tushganda sizga bitta xabar keladi. Chegarani mahsulot kartasida ham belgilash mumkin.",
  "settings.lowStock.label": "Qoldiq shundan oshmaganda ogohlantirish",
  "settings.lowStock.hint":
    "0 — ogohlantirmaslik. Faqat qoldigʻi hisoblanadigan mahsulotlar hisobga olinadi.",
  "product.lowStock": "Qoldiq shundan oshmaganda ogohlantirish",
  "product.lowStockHint": "Boʻsh boʻlsa — doʻkon chegarasi ({n}); 0 — ogohlantirmaslik.",
};
