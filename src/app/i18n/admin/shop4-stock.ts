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
  "product.preorder": "Принимать предзаказ, когда товара нет",
  "product.preorderHint":
    "Пока остатка не хватает, товар можно заказать: остаток в минус не уходит. Если остатка не хватает на весь заказ, вся позиция идёт предзаказом, а оставшиеся штуки достаются другим покупателям. При возврате заказа на склад ничего не добавляется. Покупатель видит «предзаказ» и срок отправки.",
  "product.preorderFrom": "Отправка с (дата)",
  "product.preorderFromHint": "Покупатель увидит эту дату. Пусто — «срок уточним».",
} as const;

export const kk: SectionDict<typeof ru> = {
  "settings.lowStock.title": "Қоймада таусылып барады",
  "settings.lowStock.intro":
    "Тауар қалдығы шекке дейін немесе одан төмен түскенде сізге бір хабарлама келеді. Шекті тауар картасында да қоюға болады.",
  "settings.lowStock.label": "Қалдық мынадан аспағанда ескерту",
  "settings.lowStock.hint": "0 — ескертпеу. Тек қалдығы есептелетін тауарлар ескеріледі.",
  "product.lowStock": "Қалдық мынадан аспағанда ескерту",
  "product.lowStockHint": "Бос болса — дүкен шегі ({n}); 0 — ескертпеу.",
  "product.preorder": "Тауар болмағанда алдын ала тапсырыс қабылдау",
  "product.preorderHint":
    "Қалдық жетпегенде тауарға тапсырыс беруге болады: қалдық минусқа кетпейді. Қалдық бүкіл тапсырысқа жетпесе, бүкіл позиция алдын ала тапсырыспен рәсімделеді, қалған даналар басқа сатып алушыларға қалады. Тапсырыс қайтарылғанда қоймаға ештеңе қосылмайды. Сатып алушы «алдын ала тапсырысты» және жіберу мерзімін көреді.",
  "product.preorderFrom": "Жіберу күні",
  "product.preorderFromHint": "Сатып алушы осы күнді көреді. Бос болса — «мерзімін нақтылаймыз».",
};

export const en: SectionDict<typeof ru> = {
  "settings.lowStock.title": "Running low on stock",
  "settings.lowStock.intro":
    "When a product's stock drops to the threshold or below, you get one message. A product can have its own threshold in its card.",
  "settings.lowStock.label": "Warn when no more than this is left",
  "settings.lowStock.hint": "0 — do not warn. Only products with tracked stock count.",
  "product.lowStock": "Warn when no more than this is left",
  "product.lowStockHint": "Empty — the shop threshold ({n}); 0 — do not warn.",
  "product.preorder": "Accept pre-orders when out of stock",
  "product.preorderHint":
    "While stock is short the product can still be ordered: stock never goes negative. If stock does not cover the whole order, the entire line goes as a pre-order and the remaining units stay available to other buyers. Nothing is added back to stock when such an order is returned. The buyer sees «pre-order» and the shipping date.",
  "product.preorderFrom": "Ships from (date)",
  "product.preorderFromHint": "The buyer sees this date. Empty — «we will confirm the date».",
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
  "product.preorder": "Mahsulot bo‘lmaganda oldindan buyurtma qabul qilish",
  "product.preorderHint":
    "Qoldiq yetmaganda mahsulotga buyurtma berish mumkin: qoldiq minusga tushmaydi. Qoldiq butun buyurtmaga yetmasa, butun pozitsiya oldindan buyurtma bo‘ladi, qolgan donalar boshqa xaridorlarga qoladi. Buyurtma qaytarilganda omborga hech narsa qo‘shilmaydi. Xaridor «oldindan buyurtma» va jo‘natish muddatini ko‘radi.",
  "product.preorderFrom": "Jo‘natish sanasi",
  "product.preorderFromHint": "Xaridor shu sanani ko‘radi. Bo‘sh bo‘lsa — «muddatini aniqlaymiz».",
};
