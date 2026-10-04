import type { SectionDict } from "../section";

/** Себестоимость и прибыль (С14): страница «Себестоимость», карточка товара, ошибки. */
export const ru = {
  "cost.nav": "Себестоимость",
  "cost.title": "Себестоимость товаров",
  "cost.intro":
    "Сколько вам обходится товар. Из этого в «Аналитике» считается валовая прибыль. Пусто — «не задана», а не ноль: ноль вводите, только если затрат на товар правда нет.",
  "cost.card": "Себестоимость",
  "cost.price": "Себестоимость, {cur}",
  "cost.priceHint": "Пусто — не задана. Вариант без своей суммы берёт эту.",
  "cost.variants": "По вариантам",
  "cost.sameAsProduct": "как у товара",
  "cost.notSet": "не задана",
  "cost.stale": "Себестоимость была записана в другой валюте магазина. Введите её заново в {cur}.",
  "cost.saved": "Сохранено",
  "cost.empty": "Товаров пока нет.",
  "cost.colProduct": "Товар",
  "cost.colPrice": "Цена",
  "cost.colCost": "Себестоимость",
  "cost.missing": "Без себестоимости: {n} из {total}",
  "cost.onlyMissing": "Только без себестоимости",
  "cost.staleNote": "У {n} товаров себестоимость записана в другой валюте — введите заново.",
  "err.cost.noProduct": "Товар не найден.",
  "err.cost.noVariant": "Вариант товара не найден.",
  "err.cost.badAmount": "Себестоимость — число от 0 до 1 000 000 000.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "cost.nav": "Өзіндік құн",
  "cost.title": "Тауарлардың өзіндік құны",
  "cost.intro":
    "Тауар сізге қанша тұрады. «Аналитикада» жалпы пайда осыдан есептеледі. Бос — «көрсетілмеген», нөл емес: нөлді тауарға шығын шынымен болмаса ғана енгізіңіз.",
  "cost.card": "Өзіндік құн",
  "cost.price": "Өзіндік құн, {cur}",
  "cost.priceHint": "Бос — көрсетілмеген. Өз сомасы жоқ нұсқа осыны алады.",
  "cost.variants": "Нұсқалар бойынша",
  "cost.sameAsProduct": "тауардағыдай",
  "cost.notSet": "көрсетілмеген",
  "cost.stale":
    "Өзіндік құн дүкеннің басқа валютасында жазылған. Оны {cur} валютасында қайта енгізіңіз.",
  "cost.saved": "Сақталды",
  "cost.empty": "Әзірше тауар жоқ.",
  "cost.colProduct": "Тауар",
  "cost.colPrice": "Бағасы",
  "cost.colCost": "Өзіндік құн",
  "cost.missing": "Өзіндік құнсыз: {n} / {total}",
  "cost.onlyMissing": "Тек өзіндік құны жоқтар",
  "cost.staleNote": "{n} тауардың өзіндік құны басқа валютада жазылған — қайта енгізіңіз.",
  "err.cost.noProduct": "Тауар табылмады.",
  "err.cost.noVariant": "Тауар нұсқасы табылмады.",
  "err.cost.badAmount": "Өзіндік құн — 0-ден 1 000 000 000-ға дейінгі сан.",
};

export const en: SectionDict<typeof ru> = {
  "cost.nav": "Cost",
  "cost.title": "Product cost",
  "cost.intro":
    "What a product costs you. Gross profit in Analytics is calculated from it. Empty means “not set”, not zero: enter 0 only if the product really has no costs.",
  "cost.card": "Cost",
  "cost.price": "Cost, {cur}",
  "cost.priceHint": "Empty — not set. A variant without its own amount uses this one.",
  "cost.variants": "By variant",
  "cost.sameAsProduct": "same as product",
  "cost.notSet": "not set",
  "cost.stale": "The cost was saved in another shop currency. Enter it again in {cur}.",
  "cost.saved": "Saved",
  "cost.empty": "No products yet.",
  "cost.colProduct": "Product",
  "cost.colPrice": "Price",
  "cost.colCost": "Cost",
  "cost.missing": "Without cost: {n} of {total}",
  "cost.onlyMissing": "Only without cost",
  "cost.staleNote": "{n} products have a cost saved in another currency — enter it again.",
  "err.cost.noProduct": "Product not found.",
  "err.cost.noVariant": "Product variant not found.",
  "err.cost.badAmount": "Cost must be a number from 0 to 1,000,000,000.",
};

export const uz: SectionDict<typeof ru> = {
  "cost.nav": "Tannarx",
  "cost.title": "Mahsulotlar tannarxi",
  "cost.intro":
    "Mahsulot sizga qancha tushadi. «Tahlil»da yalpi foyda shundan hisoblanadi. Boʻsh — «belgilanmagan», nol emas: nolni mahsulotga haqiqatan xarajat boʻlmagandagina kiriting.",
  "cost.card": "Tannarx",
  "cost.price": "Tannarx, {cur}",
  "cost.priceHint": "Boʻsh — belgilanmagan. Oʻz summasi yoʻq variant shuni oladi.",
  "cost.variants": "Variantlar boʻyicha",
  "cost.sameAsProduct": "mahsulotdagidek",
  "cost.notSet": "belgilanmagan",
  "cost.stale":
    "Tannarx doʻkonning boshqa valyutasida yozilgan. Uni {cur} valyutasida qayta kiriting.",
  "cost.saved": "Saqlandi",
  "cost.empty": "Hozircha mahsulot yoʻq.",
  "cost.colProduct": "Mahsulot",
  "cost.colPrice": "Narxi",
  "cost.colCost": "Tannarx",
  "cost.missing": "Tannarxsiz: {n} / {total}",
  "cost.onlyMissing": "Faqat tannarxi yoʻqlar",
  "cost.staleNote": "{n} ta mahsulotning tannarxi boshqa valyutada yozilgan — qayta kiriting.",
  "err.cost.noProduct": "Mahsulot topilmadi.",
  "err.cost.noVariant": "Mahsulot varianti topilmadi.",
  "err.cost.badAmount": "Tannarx — 0 dan 1 000 000 000 gacha son.",
};
