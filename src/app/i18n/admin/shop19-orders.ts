import type { SectionDict } from "../section";

/** Список заказов на телефоне: карточки, жест «потянуть — обновить» (А3). */
export const ru = {
  "orders.pull": "Потяните вниз, чтобы обновить",
  "orders.pullRelease": "Отпустите, чтобы обновить",
  "orders.refreshing": "Обновляем…",
  "orders.filtersLabel": "Фильтр по статусу",
  "orders.batch.pick": "Выбрать заказ {no}",
  "orders.batch.pickAll": "Выбрать все заказы на странице",
  "orders.batch.selected": "Выбрано: {n}",
  "orders.batch.selectFilter": "Выбрать все {n} по фильтру",
  "orders.batch.filterPicked": "Выбраны все {n} заказов по фильтру",
  "orders.batch.counting": "Считаем заказы…",
  "orders.batch.clear": "Снять выбор",
  "orders.batch.slips": "Упаковочные листы",
  "orders.batch.labels": "Этикетки доставки",
  "orders.batch.assemble": "Отметить собранными",
  "orders.batch.assembleHint":
    "Заказы «Принят» и «В работе» станут «Готов», покупатели получат сообщение (кроме ручных заказов). Остальные выбранные не изменятся.",
  "orders.batch.printLimit": "Печатать можно не больше {max} заказов за раз.",
  "orders.batch.done": "Собрано: {assembled}. Уже были готовы: {already}. Не подходят: {skipped}.",
  "orders.batch.notNotified":
    "Покупателям не написано: {n} (ручные заказы или сообщение не дошло).",
  "orders.batch.remaining": "Не успели обработать {n} — нажмите ещё раз.",
  "orders.filter.assembly": "К сборке сегодня",
  "batch.print": "Печать",
  "batch.empty": "Нечего печатать.",
  "batch.missing": "Заказов не найдено: {n}.",
  "batch.labelsSkipped": "Без этикеток: {n} (самовывоз или не указан адрес).",
  "batch.labelTo": "Кому",
  "batch.labelPhone": "Телефон",
  "batch.labelAddress": "Адрес",
  "batch.labelGift": "Подарок для",
  "batch.labelsNote": "На этикетках телефон и адрес покупателя — только для курьера.",
  "err.batch.tooMany":
    "Выбрано {n} заказов, за раз печатается не больше {max}. Уточните фильтр или выберите меньше.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "orders.pull": "Жаңарту үшін төмен тартыңыз",
  "orders.pullRelease": "Жаңарту үшін жіберіңіз",
  "orders.refreshing": "Жаңартып жатырмыз…",
  "orders.filtersLabel": "Күйі бойынша сүзгі",
  "orders.batch.pick": "{no} тапсырысты таңдау",
  "orders.batch.pickAll": "Беттегі барлық тапсырысты таңдау",
  "orders.batch.selected": "Таңдалды: {n}",
  "orders.batch.selectFilter": "Сүзгі бойынша барлық {n} тапсырысты таңдау",
  "orders.batch.filterPicked": "Сүзгі бойынша барлық {n} тапсырыс таңдалды",
  "orders.batch.counting": "Тапсырыстарды санап жатырмыз…",
  "orders.batch.clear": "Таңдауды алу",
  "orders.batch.slips": "Қаптау парақтары",
  "orders.batch.labels": "Жеткізу жапсырмалары",
  "orders.batch.assemble": "Жиналды деп белгілеу",
  "orders.batch.assembleHint":
    "«Қабылданған» және «Жұмыста» тапсырыстар «Дайын» болады, сатып алушыларға хабар барады (қолмен енгізілген тапсырыстарды қоспағанда). Қалған таңдалғандар өзгермейді.",
  "orders.batch.printLimit": "Бір рет көбі {max} тапсырысты басып шығаруға болады.",
  "orders.batch.done":
    "Жиналды: {assembled}. Бұрыннан дайын: {already}. Сәйкес келмейді: {skipped}.",
  "orders.batch.notNotified":
    "Сатып алушыларға жазылмады: {n} (қолмен енгізілген тапсырыстар немесе хабар жетпеді).",
  "orders.batch.remaining": "{n} тапсырысқа үлгермедік — қайта басыңыз.",
  "orders.filter.assembly": "Бүгін жинауға",
  "batch.print": "Басып шығару",
  "batch.empty": "Басып шығаратын ештеңе жоқ.",
  "batch.missing": "Табылмаған тапсырыстар: {n}.",
  "batch.labelsSkipped": "Жапсырмасыз: {n} (өзі алып кету немесе мекенжайы жоқ).",
  "batch.labelTo": "Кімге",
  "batch.labelPhone": "Телефон",
  "batch.labelAddress": "Мекенжай",
  "batch.labelGift": "Сыйлық кімге",
  "batch.labelsNote":
    "Жапсырмаларда сатып алушының телефоны мен мекенжайы бар — тек курьерге арналған.",
  "err.batch.tooMany":
    "{n} тапсырыс таңдалды, бір рет көбі {max} басып шығарылады. Сүзгіні нақтылаңыз немесе азырақ таңдаңыз.",
};

export const en: SectionDict<typeof ru> = {
  "orders.pull": "Pull down to refresh",
  "orders.pullRelease": "Release to refresh",
  "orders.refreshing": "Refreshing…",
  "orders.filtersLabel": "Filter by status",
  "orders.batch.pick": "Select order {no}",
  "orders.batch.pickAll": "Select all orders on the page",
  "orders.batch.selected": "Selected: {n}",
  "orders.batch.selectFilter": "Select all {n} matching the filter",
  "orders.batch.filterPicked": "All {n} orders matching the filter are selected",
  "orders.batch.counting": "Counting orders…",
  "orders.batch.clear": "Clear selection",
  "orders.batch.slips": "Packing slips",
  "orders.batch.labels": "Delivery labels",
  "orders.batch.assemble": "Mark as packed",
  "orders.batch.assembleHint":
    "Orders in “Accepted” and “In progress” become “Ready” and buyers get a message (except manual orders). Other selected orders stay as they are.",
  "orders.batch.printLimit": "You can print at most {max} orders at a time.",
  "orders.batch.done": "Packed: {assembled}. Already ready: {already}. Not eligible: {skipped}.",
  "orders.batch.notNotified":
    "Buyers not messaged: {n} (manual orders, or the message did not go through).",
  "orders.batch.remaining": "{n} left unprocessed — press again.",
  "orders.filter.assembly": "To pack today",
  "batch.print": "Print",
  "batch.empty": "Nothing to print.",
  "batch.missing": "Orders not found: {n}.",
  "batch.labelsSkipped": "No label: {n} (pickup or no address).",
  "batch.labelTo": "To",
  "batch.labelPhone": "Phone",
  "batch.labelAddress": "Address",
  "batch.labelGift": "Gift for",
  "batch.labelsNote": "Labels show the buyer’s phone and address — for the courier only.",
  "err.batch.tooMany":
    "{n} orders selected, at most {max} can be printed at a time. Narrow the filter or select fewer.",
};

export const uz: SectionDict<typeof ru> = {
  "orders.pull": "Yangilash uchun pastga torting",
  "orders.pullRelease": "Yangilash uchun qo‘yib yuboring",
  "orders.refreshing": "Yangilanmoqda…",
  "orders.filtersLabel": "Holat bo‘yicha filtr",
  "orders.batch.pick": "{no}-buyurtmani tanlash",
  "orders.batch.pickAll": "Sahifadagi barcha buyurtmalarni tanlash",
  "orders.batch.selected": "Tanlandi: {n}",
  "orders.batch.selectFilter": "Filtr bo‘yicha barcha {n} ta buyurtmani tanlash",
  "orders.batch.filterPicked": "Filtr bo‘yicha barcha {n} ta buyurtma tanlandi",
  "orders.batch.counting": "Buyurtmalar sanalmoqda…",
  "orders.batch.clear": "Tanlovni bekor qilish",
  "orders.batch.slips": "Qadoqlash varaqlari",
  "orders.batch.labels": "Yetkazish yorliqlari",
  "orders.batch.assemble": "Yig‘ildi deb belgilash",
  "orders.batch.assembleHint":
    "«Qabul qilingan» va «Jarayonda» buyurtmalar «Tayyor» bo‘ladi, xaridorlarga xabar boradi (qo‘lda kiritilgan buyurtmalardan tashqari). Tanlangan qolganlari o‘zgarmaydi.",
  "orders.batch.printLimit": "Bir safarda ko‘pi bilan {max} ta buyurtmani chop etish mumkin.",
  "orders.batch.done":
    "Yig‘ildi: {assembled}. Avvaldan tayyor: {already}. Mos kelmaydi: {skipped}.",
  "orders.batch.notNotified":
    "Xaridorlarga yozilmadi: {n} (qo‘lda kiritilgan buyurtmalar yoki xabar yetib bormadi).",
  "orders.batch.remaining": "{n} tasiga ulgurmadik — yana bosing.",
  "orders.filter.assembly": "Bugun yig‘ish kerak",
  "batch.print": "Chop etish",
  "batch.empty": "Chop etadigan narsa yo‘q.",
  "batch.missing": "Topilmagan buyurtmalar: {n}.",
  "batch.labelsSkipped": "Yorliqsiz: {n} (olib ketish yoki manzil ko‘rsatilmagan).",
  "batch.labelTo": "Kimga",
  "batch.labelPhone": "Telefon",
  "batch.labelAddress": "Manzil",
  "batch.labelGift": "Sovg‘a kimga",
  "batch.labelsNote": "Yorliqlarda xaridorning telefoni va manzili bor — faqat kuryer uchun.",
  "err.batch.tooMany":
    "{n} ta buyurtma tanlandi, bir safarda ko‘pi bilan {max} ta chop etiladi. Filtrni aniqlashtiring yoki kamroq tanlang.",
};
