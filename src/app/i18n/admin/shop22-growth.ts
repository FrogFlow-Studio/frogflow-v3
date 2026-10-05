import type { SectionDict } from "../section";

/** Аналитика роста (партия 22, путь У): «Вернулись покупатели». */
export const ru = {
  "growth.returning.title": "Вернулись покупатели",
  "growth.returning.none": "За этот период оплаченных заказов пока нет.",
  "growth.returning.share": "{n} % покупателей периода уже покупали раньше: {back} из {all}.",
  "growth.returning.fresh": "Новые покупатели",
  "growth.returning.back": "Вернувшиеся",
  "growth.returning.buyers": "Покупателей",
  "growth.returning.avg": "Средний чек",
  "growth.returning.hint":
    "Считаются только оплаченные заказы. Вернувшийся — тот, у кого первая оплата была до начала периода; история берётся за последний год.",
  "growth.promote.title": "Что продвигать",
  "growth.promote.failed": "Не удалось загрузить",
  "growth.promote.empty":
    "Пока нечего подсказать: ни хорошо оценённых товаров, которые редко берут, ни товаров, которые скоро закончатся.",
  "growth.promote.quality": "Хорошо оценивают, а берут редко",
  "growth.promote.qualityItem": "оценка {avg} ({count}), куплено за {days} дн.: {sold}",
  "growth.promote.stock": "Остатка мало при спросе",
  "growth.promote.stockItem":
    "остаток {stock}, куплено за {days} дн.: {sold}; на {left} дн. при том же темпе",
  "growth.promote.stockOut": "остаток закончился, куплено за {days} дн.: {sold}",
  "growth.promote.more": "Показаны первые {shown}, всего подходит {total}.",
  "growth.promote.hint":
    "Это арифметика по прошлым продажам и одобренным отзывам, а не прогноз: проверьте товар сами, прежде чем запускать акцию или пополнять склад.",
  "growth.card.title": "Рост",
  "growth.card.caption": "Последние 30 дней к предыдущим 30",
  "growth.card.revenue": "Выручка",
  "growth.card.orders": "Оплаченные заказы",
  "growth.card.buyers": "Новые покупатели",
  "growth.card.up": "▲ {n} %",
  "growth.card.down": "▼ {n} %",
  "growth.card.same": "без изменений",
  "growth.card.noBase": "не с чем сравнить",
  "growth.card.more": "Подробнее в «Аналитике»",
};

export const kk: SectionDict<typeof ru> = {
  "growth.returning.title": "Қайта оралған сатып алушылар",
  "growth.returning.none": "Осы кезеңде төленген тапсырыстар әлі жоқ.",
  "growth.returning.share":
    "Кезеңдегі сатып алушылардың {n} % бұрын да сатып алған: {all} ішінен {back}.",
  "growth.returning.fresh": "Жаңа сатып алушылар",
  "growth.returning.back": "Қайта оралғандар",
  "growth.returning.buyers": "Сатып алушылар",
  "growth.returning.avg": "Орташа чек",
  "growth.returning.hint":
    "Тек төленген тапсырыстар есептеледі. Қайта оралған — алғашқы төлемі кезең басталғанға дейін болған адам; тарих соңғы жылға алынады.",
  "growth.promote.title": "Нені алға жылжыту керек",
  "growth.promote.failed": "Жүктеу мүмкін болмады",
  "growth.promote.empty":
    "Әзірге кеңес жоқ: сирек алынатын жақсы бағаланған тауар да, жақында таусылатын тауар да жоқ.",
  "growth.promote.quality": "Жақсы бағалайды, бірақ сирек алады",
  "growth.promote.qualityItem": "баға {avg} ({count}), {days} күнде сатылды: {sold}",
  "growth.promote.stock": "Сұранысқа қарағанда қалдық аз",
  "growth.promote.stockItem":
    "қалдық {stock}, {days} күнде сатылды: {sold}; сол қарқынмен {left} күнге жетеді",
  "growth.promote.stockOut": "қалдық таусылды, {days} күнде сатылды: {sold}",
  "growth.promote.more": "Алғашқы {shown} көрсетілген, барлығы {total}.",
  "growth.promote.hint":
    "Бұл болжам емес, өткен сатылым мен мақұлданған пікірлер бойынша есеп: акция бастамас бұрын немесе қойманы толтырмас бұрын тауарды өзіңіз тексеріңіз.",
  "growth.card.title": "Өсу",
  "growth.card.caption": "Соңғы 30 күн алдыңғы 30 күнмен салыстырғанда",
  "growth.card.revenue": "Түсім",
  "growth.card.orders": "Төленген тапсырыстар",
  "growth.card.buyers": "Жаңа сатып алушылар",
  "growth.card.up": "▲ {n} %",
  "growth.card.down": "▼ {n} %",
  "growth.card.same": "өзгеріссіз",
  "growth.card.noBase": "салыстыратын ештеңе жоқ",
  "growth.card.more": "«Аналитикада» толығырақ",
};

export const en: SectionDict<typeof ru> = {
  "growth.returning.title": "Returning customers",
  "growth.returning.none": "No paid orders in this period yet.",
  "growth.returning.share": "{n}% of the period's buyers had bought before: {back} of {all}.",
  "growth.returning.fresh": "New customers",
  "growth.returning.back": "Returning",
  "growth.returning.buyers": "Customers",
  "growth.returning.avg": "Average order",
  "growth.returning.hint":
    "Only paid orders count. A returning customer made their first payment before the period began; history covers the last year.",
  "growth.promote.title": "What to promote",
  "growth.promote.failed": "Could not load",
  "growth.promote.empty":
    "Nothing to suggest yet: no well-rated products that sell rarely and none about to run out.",
  "growth.promote.quality": "Rated well, but rarely bought",
  "growth.promote.qualityItem": "rating {avg} ({count}), bought in {days} days: {sold}",
  "growth.promote.stock": "Low stock for the demand",
  "growth.promote.stockItem":
    "stock {stock}, bought in {days} days: {sold}; lasts {left} days at the same pace",
  "growth.promote.stockOut": "out of stock, bought in {days} days: {sold}",
  "growth.promote.more": "Showing the first {shown} of {total}.",
  "growth.promote.hint":
    "This is arithmetic on past sales and approved reviews, not a forecast: check the product yourself before running a promotion or restocking.",
  "growth.card.title": "Growth",
  "growth.card.caption": "Last 30 days vs the previous 30",
  "growth.card.revenue": "Revenue",
  "growth.card.orders": "Paid orders",
  "growth.card.buyers": "New customers",
  "growth.card.up": "▲ {n}%",
  "growth.card.down": "▼ {n}%",
  "growth.card.same": "no change",
  "growth.card.noBase": "nothing to compare with",
  "growth.card.more": "More in Analytics",
};

export const uz: SectionDict<typeof ru> = {
  "growth.returning.title": "Qaytgan xaridorlar",
  "growth.returning.none": "Bu davrda to‘langan buyurtmalar hali yo‘q.",
  "growth.returning.share":
    "Davrdagi xaridorlarning {n} % i avval ham xarid qilgan: {all} tadan {back} tasi.",
  "growth.returning.fresh": "Yangi xaridorlar",
  "growth.returning.back": "Qaytganlar",
  "growth.returning.buyers": "Xaridorlar",
  "growth.returning.avg": "O‘rtacha chek",
  "growth.returning.hint":
    "Faqat to‘langan buyurtmalar hisoblanadi. Qaytgan xaridor — birinchi to‘lovi davr boshidan oldin bo‘lgan kishi; tarix so‘nggi yil bo‘yicha olinadi.",
  "growth.promote.title": "Nimani targ‘ib qilish kerak",
  "growth.promote.failed": "Yuklab bo‘lmadi",
  "growth.promote.empty":
    "Hozircha maslahat yo‘q: kam sotiladigan yaxshi baholangan mahsulot ham, tez orada tugaydigan mahsulot ham yo‘q.",
  "growth.promote.quality": "Yaxshi baholanadi, lekin kam olinadi",
  "growth.promote.qualityItem": "baho {avg} ({count}), {days} kunda sotilgan: {sold}",
  "growth.promote.stock": "Talabga nisbatan qoldiq kam",
  "growth.promote.stockItem":
    "qoldiq {stock}, {days} kunda sotilgan: {sold}; shu sur’atda {left} kunga yetadi",
  "growth.promote.stockOut": "qoldiq tugagan, {days} kunda sotilgan: {sold}",
  "growth.promote.more": "Dastlabki {shown} ta ko‘rsatilgan, jami {total} ta.",
  "growth.promote.hint":
    "Bu bashorat emas, o‘tgan savdo va tasdiqlangan sharhlar bo‘yicha hisob: aksiya boshlashdan yoki omborni to‘ldirishdan oldin mahsulotni o‘zingiz tekshiring.",
  "growth.card.title": "O‘sish",
  "growth.card.caption": "So‘nggi 30 kun oldingi 30 kunga nisbatan",
  "growth.card.revenue": "Tushum",
  "growth.card.orders": "To‘langan buyurtmalar",
  "growth.card.buyers": "Yangi xaridorlar",
  "growth.card.up": "▲ {n} %",
  "growth.card.down": "▼ {n} %",
  "growth.card.same": "o‘zgarishsiz",
  "growth.card.noBase": "solishtirish uchun ma’lumot yo‘q",
  "growth.card.more": "«Analitika»da batafsil",
};
