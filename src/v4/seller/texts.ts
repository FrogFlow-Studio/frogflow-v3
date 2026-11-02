/** Строки покупателю, которые бот говорит без модели. 4 языка (CLAUDE.md). */

export const BUYER_LANGS = ["ru", "kk", "en", "uz"] as const;
export type BuyerLang = (typeof BUYER_LANGS)[number];

export const asLang = (v: unknown): BuyerLang =>
  BUYER_LANGS.includes(v as BuyerLang) ? (v as BuyerLang) : "ru";

export const TEXTS = {
  /** Без модели (лимит ИИ или модель не ответила), товары нашлись. */
  found: {
    ru: "Вот что нашлось. Нажмите «Купить» под нужным товаром, а на вопросы ответит продавец.",
    kk: "Міне, табылғаны. Керек тауардың астындағы «Сатып алу» батырмасын басыңыз, сұрақтарға сатушы жауап береді.",
    en: "Here is what I found. Tap “Buy” under the item you need; the seller will answer any questions.",
    uz: "Mana topilganlar. Kerakli mahsulot ostidagi «Sotib olish» tugmasini bosing, savollarga sotuvchi javob beradi.",
  },
  /** Без модели, товар не нашёлся. */
  hold: {
    ru: "Спасибо за сообщение! Продавец ответит вам в рабочее время.",
    kk: "Хабарламаңызға рахмет! Сатушы жұмыс уақытында жауап береді.",
    en: "Thank you for your message! The seller will reply during working hours.",
    uz: "Xabaringiz uchun rahmat! Sotuvchi ish vaqtida javob beradi.",
  },
  buy: { ru: "Купить", kk: "Сатып алу", en: "Buy", uz: "Sotib olish" },
  cabinet: {
    ru: "Ваши покупки",
    kk: "Сатып алғандарыңыз",
    en: "Your purchases",
    uz: "Xaridlaringiz",
  },
} as const satisfies Record<string, Record<BuyerLang, string>>;
