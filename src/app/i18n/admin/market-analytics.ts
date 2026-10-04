import type { SectionDict } from "../section";

/** Площадка FrogFlow (В20): «ваши переходы с площадки». */
export const ru = {
  "settings.market.clicks": "Переходы с площадки за {days} дней: {count}",
  "settings.market.clicksSoon": "Счётчик переходов появится вместе с площадкой.",
  "settings.market.clicksHint":
    "Считаем переходы в вашу витрину из каталога без личных данных: один человек за час учитывается один раз.",
};
export const kk: SectionDict<typeof ru> = {
  "settings.market.clicks": "Алаңнан соңғы {days} күндегі өтулер: {count}",
  "settings.market.clicksSoon": "Өтулер санағышы алаңмен бірге пайда болады.",
  "settings.market.clicksHint":
    "Каталогтан витринаңызға өтулерді жеке деректерсіз санаймыз: бір адам сағатына бір рет есептеледі.",
};
export const en: SectionDict<typeof ru> = {
  "settings.market.clicks": "Visits from the marketplace in the last {days} days: {count}",
  "settings.market.clicksSoon": "The visit counter appears together with the marketplace.",
  "settings.market.clicksHint":
    "We count visits to your storefront from the catalogue without personal data: one person is counted once per hour.",
};
export const uz: SectionDict<typeof ru> = {
  "settings.market.clicks": "Soʻnggi {days} kunda maydondan oʻtishlar: {count}",
  "settings.market.clicksSoon": "Oʻtishlar hisoblagichi maydon bilan birga paydo boʻladi.",
  "settings.market.clicksHint":
    "Katalogdan vitrinangizga oʻtishlarni shaxsiy maʼlumotsiz sanaymiz: bir kishi soatiga bir marta hisoblanadi.",
};
