import type { SectionDict } from "../section";

/** Страница «Комиссия» в админке продавца (core/commission): что облагается, сколько, когда выгоднее другой тариф. */
export const ru = {
  "commission.nav": "Комиссия",
  "commission.title": "Комиссия платформы",
  "commission.rule":
    "С оплаченных заказов вашей витрины и маркета платформа берёт {rate} % на тарифе {tier}. Первые {free} продаж в месяц комиссией не облагаются: процент считается только с продаж сверх этой суммы. Возвраты уменьшают продажи.",
  "commission.bots": "Заказы из ботов Telegram, Instagram и WhatsApp не облагаются.",
  "commission.off":
    "Комиссия пока не начисляется. Ниже ваши продажи с витрины и маркета: с них она считалась бы.",
  "commission.noRate": "На ваших условиях комиссия не начисляется.",
  "commission.start": "Начисление начинается с {date}.",
  "commission.thisMonth": "Этот месяц",
  "commission.lastMonth": "Прошлый месяц",
  "commission.sales": "Продажи с витрины и маркета",
  "commission.orders": "Оплаченных заказов",
  "commission.free": "Не облагается",
  "commission.taxable": "С чего считается процент",
  "commission.amount": "Комиссия",
  "commission.notAccrued": "не начисляется",
  "commission.advice":
    "По продажам за {month} тариф {tier} вышел бы дешевле: подписка вместе с комиссией {cost} вместо {current} в месяц, разница {saving}. Доплаты за каналы в сравнение не входят.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "commission.nav": "Комиссия",
  "commission.title": "Платформа комиссиясы",
  "commission.rule":
    "Витринаңыз бен маркеттің төленген тапсырыстарынан платформа {tier} тарифінде {rate} % алады. Айына алғашқы {free} сатылым комиссиядан босатылған: пайыз осы соммадан асатын сатылымнан ғана есептеледі. Қайтарулар сатылымды азайтады.",
  "commission.bots":
    "Telegram, Instagram және WhatsApp боттарынан түскен тапсырыстарға комиссия салынбайды.",
  "commission.off":
    "Комиссия әзірге есептелмейді. Төменде витринаңыз бен маркеттен түскен сатылымдар: комиссия солардан есептелер еді.",
  "commission.noRate": "Сіздің шарттарыңызда комиссия есептелмейді.",
  "commission.start": "Есептеу {date} күнінен басталады.",
  "commission.thisMonth": "Осы ай",
  "commission.lastMonth": "Өткен ай",
  "commission.sales": "Витрина мен маркеттен сатылым",
  "commission.orders": "Төленген тапсырыстар",
  "commission.free": "Салықсыз бөлігі",
  "commission.taxable": "Пайыз есептелетін сома",
  "commission.amount": "Комиссия",
  "commission.notAccrued": "есептелмейді",
  "commission.advice":
    "{month} сатылымы бойынша {tier} тарифі арзанырақ болар еді: жазылым мен комиссия бірге айына {current} орнына {cost}, айырма {saving}. Арналарға қосымша төлемдер салыстыруға кірмейді.",
};

export const en: SectionDict<typeof ru> = {
  "commission.nav": "Commission",
  "commission.title": "Platform commission",
  "commission.rule":
    "The platform takes {rate} % of paid orders from your storefront and marketplace on the {tier} plan. The first {free} of sales each month carry no commission: the percentage applies only to sales above that amount. Refunds reduce sales.",
  "commission.bots": "Orders from Telegram, Instagram and WhatsApp bots are not charged.",
  "commission.off":
    "Commission is not being charged yet. Below are your storefront and marketplace sales it would be calculated from.",
  "commission.noRate": "No commission is charged on your terms.",
  "commission.start": "Charging starts on {date}.",
  "commission.thisMonth": "This month",
  "commission.lastMonth": "Last month",
  "commission.sales": "Storefront and marketplace sales",
  "commission.orders": "Paid orders",
  "commission.free": "Not charged",
  "commission.taxable": "Amount the percentage applies to",
  "commission.amount": "Commission",
  "commission.notAccrued": "not charged",
  "commission.advice":
    "With your sales for {month} the {tier} plan would cost less: subscription plus commission {cost} instead of {current} a month, a difference of {saving}. Channel add-ons are not part of the comparison.",
};

export const uz: SectionDict<typeof ru> = {
  "commission.nav": "Komissiya",
  "commission.title": "Platforma komissiyasi",
  "commission.rule":
    "Vitrina va marketdagi toʻlangan buyurtmalardan platforma {tier} tarifida {rate} % oladi. Oyiga dastlabki {free} savdo komissiyadan ozod: foiz faqat shu summadan oshgan savdodan hisoblanadi. Qaytarishlar savdoni kamaytiradi.",
  "commission.bots":
    "Telegram, Instagram va WhatsApp botlaridan kelgan buyurtmalarga komissiya olinmaydi.",
  "commission.off":
    "Komissiya hozircha hisoblanmaydi. Quyida vitrina va marketdagi savdolaringiz: komissiya shulardan hisoblanardi.",
  "commission.noRate": "Sizning shartlaringizda komissiya hisoblanmaydi.",
  "commission.start": "Hisoblash {date} dan boshlanadi.",
  "commission.thisMonth": "Shu oy",
  "commission.lastMonth": "Oʻtgan oy",
  "commission.sales": "Vitrina va marketdan savdo",
  "commission.orders": "Toʻlangan buyurtmalar",
  "commission.free": "Olinmaydigan qism",
  "commission.taxable": "Foiz hisoblanadigan summa",
  "commission.amount": "Komissiya",
  "commission.notAccrued": "hisoblanmaydi",
  "commission.advice":
    "{month} savdosi boʻyicha {tier} tarifi arzonroq boʻlardi: obuna va komissiya birgalikda oyiga {current} oʻrniga {cost}, farqi {saving}. Kanallar uchun qoʻshimcha toʻlovlar solishtirishga kirmaydi.",
};
