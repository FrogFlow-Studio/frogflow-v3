import type { SectionDict } from "../section";

/** Тема материала для «Похожих» (Т5): поле в форме товара, массовое назначение, фильтр. */
export const ru = {
  "product.topics": "Тема (для «Похожих»)",
  "product.topicsHint":
    "Главное слово материала: по нему в магазине подбираются «Похожие». Можно несколько через запятую. Покупатель тему не видит, но поиск по ней находит материал.",
  "product.topicsPlaceholder": "1 сентября, Части речи",
  "product.topicsExisting": "Уже есть в магазине:",
  "products.noTopic": "Без темы",
  "products.bulk.topic": "Тема",
  "products.bulk.topicAdd": "Назначить тему",
  "products.bulk.topicRemove": "Убрать тему",
  "err.catalog.bulkTopic": "Тема — от 1 до {max} символов.",
  "products.bulk.reason.keywordsChanged": "ключевые слова успели изменить, товар не тронут",
} as const;

export const kk: SectionDict<typeof ru> = {
  "product.topics": "Тақырып («Ұқсастар» үшін)",
  "product.topicsHint":
    "Материалдың басты сөзі: дүкенде «Ұқсастар» осы бойынша таңдалады. Үтір арқылы бірнешеуін жазуға болады. Сатып алушы тақырыпты көрмейді, бірақ іздеу материалды ол бойынша табады.",
  "product.topicsPlaceholder": "1 қыркүйек, Сөз таптары",
  "product.topicsExisting": "Дүкенде бар:",
  "products.noTopic": "Тақырыпсыз",
  "products.bulk.topic": "Тақырып",
  "products.bulk.topicAdd": "Тақырып беру",
  "products.bulk.topicRemove": "Тақырыпты алып тастау",
  "err.catalog.bulkTopic": "Тақырып — 1-ден {max} таңбаға дейін.",
  "products.bulk.reason.keywordsChanged": "кілт сөздер өзгеріп үлгерді, тауар өзгертілмеді",
};

export const en: SectionDict<typeof ru> = {
  "product.topics": "Topic (for “Similar”)",
  "product.topicsHint":
    "The main word of the item: the store picks “Similar” items by it. Several are allowed, comma-separated. Buyers don't see the topic, but search finds the item by it.",
  "product.topicsPlaceholder": "Back to school, Parts of speech",
  "product.topicsExisting": "Already in the store:",
  "products.noTopic": "No topic",
  "products.bulk.topic": "Topic",
  "products.bulk.topicAdd": "Set topic",
  "products.bulk.topicRemove": "Remove topic",
  "err.catalog.bulkTopic": "A topic is 1 to {max} characters.",
  "products.bulk.reason.keywordsChanged": "keywords changed meanwhile, product left as is",
};

export const uz: SectionDict<typeof ru> = {
  "product.topics": "Mavzu («O‘xshashlar» uchun)",
  "product.topicsHint":
    "Materialning asosiy so‘zi: do‘konda «O‘xshashlar» shu bo‘yicha tanlanadi. Vergul bilan bir nechtasini yozish mumkin. Xaridor mavzuni ko‘rmaydi, lekin qidiruv materialni u bo‘yicha topadi.",
  "product.topicsPlaceholder": "1-sentabr, So‘z turkumlari",
  "product.topicsExisting": "Do‘konda bor:",
  "products.noTopic": "Mavzusiz",
  "products.bulk.topic": "Mavzu",
  "products.bulk.topicAdd": "Mavzu berish",
  "products.bulk.topicRemove": "Mavzuni olib tashlash",
  "err.catalog.bulkTopic": "Mavzu — 1 dan {max} belgigacha.",
  "products.bulk.reason.keywordsChanged":
    "kalit so‘zlar o‘zgartirib bo‘lingan, mahsulotga tegilmadi",
};
