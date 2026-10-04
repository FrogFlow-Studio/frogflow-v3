import type { SectionDict } from "../section";

/** Склад: отчёт «Залежавшийся товар» (С7) и очередь акций из него. */
export const ru = {
  "warehouse.hub.stale": "Залежавшийся товар",
  "warehouse.hub.staleHint": "Что лежит без продаж и сколько денег в этом заморожено.",
  "stale.title": "Залежавшийся товар",
  "stale.subtitle":
    "Товары с остатком, которые не продавались {days} дн. Новые товары (моложе этого срока) не показываются.",
  "stale.params": "Отчёт",
  "stale.days": "Без продаж, дней",
  "stale.apply": "Показать",
  "stale.defaultHint": "Обычно {days} дн.",
  "stale.total": "Залежалось товаров: {n}. Заморожено по себестоимости: {sum}.",
  "stale.unknownCost":
    "У товаров без себестоимости ({n}) деньги в сумму не входят — задайте её в «Прибыли».",
  "stale.empty": "Залежавшегося товара нет: всё с остатком продавалось за последние {days} дн.",
  "stale.col.name": "Товар",
  "stale.col.stock": "Остаток",
  "stale.col.unitCost": "Себестоимость",
  "stale.col.frozen": "Заморожено",
  "stale.pick": "Выбрать «{name}»",
  "stale.createOffer": "Создать акцию",
  "stale.picked": "Выбрано: {n}",
  "stale.pickedMax": "Выбрано больше {max} — в акцию уйдут первые {max}.",
  "discounts.offers.queue":
    "Из отчёта о залежавшемся товаре: осталось создать акций — {n}. Скидка и сроки сохраняются для следующего товара.",
};

export const kk: SectionDict<typeof ru> = {
  "warehouse.hub.stale": "Тұрып қалған тауар",
  "warehouse.hub.staleHint": "Сатылмай жатқан тауарлар және онда қанша ақша қатып тұр.",
  "stale.title": "Тұрып қалған тауар",
  "stale.subtitle":
    "{days} күн сатылмаған қалдығы бар тауарлар. Осы мерзімнен жаңа тауарлар көрсетілмейді.",
  "stale.params": "Есеп",
  "stale.days": "Сатылымсыз, күн",
  "stale.apply": "Көрсету",
  "stale.defaultHint": "Әдетте {days} күн.",
  "stale.total": "Тұрып қалған тауар: {n}. Өзіндік құны бойынша қатқан сома: {sum}.",
  "stale.unknownCost":
    "Өзіндік құны жоқ тауарлардың ({n}) ақшасы сомаға кірмейді — оны «Пайда» бөлімінде көрсетіңіз.",
  "stale.empty": "Тұрып қалған тауар жоқ: қалдығы бар барлығы соңғы {days} күнде сатылған.",
  "stale.col.name": "Тауар",
  "stale.col.stock": "Қалдық",
  "stale.col.unitCost": "Өзіндік құны",
  "stale.col.frozen": "Қатқан сома",
  "stale.pick": "«{name}» таңдау",
  "stale.createOffer": "Акция жасау",
  "stale.picked": "Таңдалды: {n}",
  "stale.pickedMax": "{max}-тан көп таңдалды — акцияға алғашқы {max} кетеді.",
  "discounts.offers.queue":
    "Тұрып қалған тауар есебінен: жасалатын акция қалды — {n}. Жеңілдік пен мерзім келесі тауарға сақталады.",
};

export const en: SectionDict<typeof ru> = {
  "warehouse.hub.stale": "Slow-moving stock",
  "warehouse.hub.staleHint": "What has not sold and how much money is tied up in it.",
  "stale.title": "Slow-moving stock",
  "stale.subtitle":
    "Products in stock with no sales for {days} days. Products newer than that are not shown.",
  "stale.params": "Report",
  "stale.days": "No sales, days",
  "stale.apply": "Show",
  "stale.defaultHint": "Usually {days} days.",
  "stale.total": "Slow-moving products: {n}. Tied up at cost: {sum}.",
  "stale.unknownCost":
    "Products without a cost ({n}) are not included in the sum — set it under “Profit”.",
  "stale.empty": "No slow-moving stock: everything in stock sold within the last {days} days.",
  "stale.col.name": "Product",
  "stale.col.stock": "In stock",
  "stale.col.unitCost": "Unit cost",
  "stale.col.frozen": "Tied up",
  "stale.pick": "Select “{name}”",
  "stale.createOffer": "Create offer",
  "stale.picked": "Selected: {n}",
  "stale.pickedMax": "More than {max} selected — the first {max} go to the offer.",
  "discounts.offers.queue":
    "From the slow-moving report: offers left to create — {n}. The discount and dates carry over to the next product.",
};

export const uz: SectionDict<typeof ru> = {
  "warehouse.hub.stale": "Sotilmay yotgan tovar",
  "warehouse.hub.staleHint": "Nima sotilmay yotibdi va bunda qancha pul qotib qolgan.",
  "stale.title": "Sotilmay yotgan tovar",
  "stale.subtitle":
    "{days} kun sotilmagan, qoldigʻi bor tovarlar. Bu muddatdan yangi tovarlar koʻrsatilmaydi.",
  "stale.params": "Hisobot",
  "stale.days": "Savdosiz, kun",
  "stale.apply": "Koʻrsatish",
  "stale.defaultHint": "Odatda {days} kun.",
  "stale.total": "Sotilmay yotgan tovarlar: {n}. Tannarx boʻyicha qotgan pul: {sum}.",
  "stale.unknownCost":
    "Tannarxi yoʻq tovarlar ({n}) puli yigʻindiga kirmaydi — uni «Foyda» boʻlimida kiriting.",
  "stale.empty":
    "Sotilmay yotgan tovar yoʻq: qoldigʻi bor hamma narsa soʻnggi {days} kunda sotilgan.",
  "stale.col.name": "Tovar",
  "stale.col.stock": "Qoldiq",
  "stale.col.unitCost": "Tannarx",
  "stale.col.frozen": "Qotgan pul",
  "stale.pick": "«{name}» ni tanlash",
  "stale.createOffer": "Aksiya yaratish",
  "stale.picked": "Tanlandi: {n}",
  "stale.pickedMax": "{max} tadan koʻp tanlandi — aksiyaga dastlabki {max} tasi ketadi.",
  "discounts.offers.queue":
    "Sotilmay yotgan tovar hisobotidan: yaratiladigan aksiyalar qoldi — {n}. Chegirma va muddat keyingi tovarga saqlanadi.",
};
