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
  /** Передали продавцу (простой ответ или проверка не прошла). */
  handedOff: {
    ru: "Передал ваш вопрос продавцу — он ответит здесь же.",
    kk: "Сұрағыңызды сатушыға жібердім — ол осы жерде жауап береді.",
    en: "I’ve passed your question to the seller — they will reply here.",
    uz: "Savolingizni sotuvchiga yubordim — u shu yerda javob beradi.",
  },
  /** Модель показала кнопку без текста (G01). */
  tapBuy: {
    ru: "Нажмите «Купить» под сообщением.",
    kk: "Хабарлама астындағы «Сатып алу» батырмасын басыңыз.",
    en: "Tap “Buy” under this message.",
    uz: "Xabar ostidagi «Sotib olish» tugmasini bosing.",
  },
  /** «+» на предложение — заказ (C14). {no} — номер заказа. */
  ordered: {
    ru: "Заказ №{no} оформлен. Как оплатить — в следующем сообщении.",
    kk: "№{no} тапсырыс рәсімделді. Қалай төлеу керегі — келесі хабарламада.",
    en: "Order #{no} is placed. How to pay is in the next message.",
    uz: "№{no} buyurtma rasmiylashtirildi. Qanday to'lash — keyingi xabarda.",
  },
  /** «+» на устаревшее предложение — новая цена и новая кнопка (Д3). */
  newPrice: {
    ru: "Цена обновилась — новая кнопка ниже.",
    kk: "Баға жаңарды — жаңа батырма төменде.",
    en: "The price has been updated — the new button is below.",
    uz: "Narx yangilandi — yangi tugma pastda.",
  },
  buy: { ru: "Купить", kk: "Сатып алу", en: "Buy", uz: "Sotib olish" },
  /** Кнопка одного предложения на несколько товаров. */
  buyAll: {
    ru: "Купить всё",
    kk: "Барлығын сатып алу",
    en: "Buy all",
    uz: "Hammasini sotib olish",
  },
  cabinet: {
    ru: "Ваши покупки",
    kk: "Сатып алғандарыңыз",
    en: "Your purchases",
    uz: "Xaridlaringiz",
  },
} as const satisfies Record<string, Record<BuyerLang, string>>;
