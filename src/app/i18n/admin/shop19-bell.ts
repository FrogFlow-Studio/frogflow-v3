import type { SectionDict } from "../section";

/** Центр уведомлений (А12). */
export const ru = {
  "bell.nav": "Уведомления",
  "bell.title": "Уведомления",
  "bell.subtitle": "Новые заказы, чеки на проверке, возвраты и отзывы за последние 30 дней.",
  "bell.today": "Сегодня",
  "bell.earlier": "Раньше",
  "bell.empty": "За 30 дней событий нет.",
  "bell.consultantNote":
    "Здесь — заказы, чеки, отзывы и возвраты; у консультанта без продаж их нет. Когда консультант передаёт диалог менеджеру, вам приходит уведомление в Telegram.",
  "bell.consultantNoteTasks": "Передача менеджеру попадает и в задачи консультанта.",
  "bell.markRead": "Отметить всё прочитанным",
  "bell.new": "Новое",
  "bell.filterAll": "Все",
  "bell.type.order": "Заказы",
  "bell.type.receipt": "Чеки",
  "bell.type.review": "Отзывы",
  "bell.type.refund": "Возвраты",
  "bell.item.order": "Новый заказ №{no}",
  "bell.item.receipt": "Чек на проверке: заказ №{no}",
  "bell.item.refund": "Возврат по заказу №{no}",
  "bell.item.review": "Новый отзыв: {rating} из 5",
  "bell.shown": "Показаны последние {n} из {total} событий.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "bell.nav": "Хабарландырулар",
  "bell.title": "Хабарландырулар",
  "bell.subtitle":
    "Соңғы 30 күндегі жаңа тапсырыстар, тексеруді күтетін чектер, қайтарулар мен пікірлер.",
  "bell.today": "Бүгін",
  "bell.earlier": "Бұрын",
  "bell.empty": "30 күнде оқиғалар жоқ.",
  "bell.consultantNote":
    "Мұнда — тапсырыстар, чектер, пікірлер мен қайтарулар; сатусыз кеңесшіде олар жоқ. Кеңесші диалогты менеджерге бергенде, сізге Telegram-да хабарлама келеді.",
  "bell.consultantNoteTasks": "Менеджерге берілген диалог кеңесшінің тапсырмаларына да түседі.",
  "bell.markRead": "Бәрін оқылды деп белгілеу",
  "bell.new": "Жаңа",
  "bell.filterAll": "Барлығы",
  "bell.type.order": "Тапсырыстар",
  "bell.type.receipt": "Чектер",
  "bell.type.review": "Пікірлер",
  "bell.type.refund": "Қайтарулар",
  "bell.item.order": "Жаңа тапсырыс №{no}",
  "bell.item.receipt": "Чек тексеруде: тапсырыс №{no}",
  "bell.item.refund": "№{no} тапсырыс бойынша қайтару",
  "bell.item.review": "Жаңа пікір: 5-тен {rating}",
  "bell.shown": "{total} оқиғаның соңғы {n} көрсетілген.",
};

export const en: SectionDict<typeof ru> = {
  "bell.nav": "Notifications",
  "bell.title": "Notifications",
  "bell.subtitle": "New orders, receipts to review, refunds and reviews from the last 30 days.",
  "bell.today": "Today",
  "bell.earlier": "Earlier",
  "bell.empty": "No events in the last 30 days.",
  "bell.consultantNote":
    "This page lists orders, receipts, reviews and refunds; a consultant without sales has none. When the consultant hands a dialogue to a manager, you get a Telegram notification.",
  "bell.consultantNoteTasks": "The handoff also becomes a consultant task.",
  "bell.markRead": "Mark all as read",
  "bell.new": "New",
  "bell.filterAll": "All",
  "bell.type.order": "Orders",
  "bell.type.receipt": "Receipts",
  "bell.type.review": "Reviews",
  "bell.type.refund": "Refunds",
  "bell.item.order": "New order #{no}",
  "bell.item.receipt": "Receipt to review: order #{no}",
  "bell.item.refund": "Refund on order #{no}",
  "bell.item.review": "New review: {rating} of 5",
  "bell.shown": "Showing the latest {n} of {total} events.",
};

export const uz: SectionDict<typeof ru> = {
  "bell.nav": "Bildirishnomalar",
  "bell.title": "Bildirishnomalar",
  "bell.subtitle":
    "Oxirgi 30 kundagi yangi buyurtmalar, tekshiruvdagi cheklar, qaytarishlar va sharhlar.",
  "bell.today": "Bugun",
  "bell.earlier": "Avvalroq",
  "bell.empty": "30 kunda voqealar yo‘q.",
  "bell.consultantNote":
    "Bu yerda — buyurtmalar, cheklar, sharhlar va qaytarishlar; savdosiz maslahatchida ular yo‘q. Maslahatchi suhbatni menejerga topshirganda, sizga Telegram'da xabar keladi.",
  "bell.consultantNoteTasks": "Menejerga topshirilgan suhbat maslahatchi vazifalariga ham tushadi.",
  "bell.markRead": "Hammasini o‘qilgan deb belgilash",
  "bell.new": "Yangi",
  "bell.filterAll": "Hammasi",
  "bell.type.order": "Buyurtmalar",
  "bell.type.receipt": "Cheklar",
  "bell.type.review": "Sharhlar",
  "bell.type.refund": "Qaytarishlar",
  "bell.item.order": "Yangi buyurtma №{no}",
  "bell.item.receipt": "Chek tekshiruvda: buyurtma №{no}",
  "bell.item.refund": "№{no} buyurtma bo‘yicha qaytarish",
  "bell.item.review": "Yangi sharh: 5 dan {rating}",
  "bell.shown": "{total} ta voqeadan oxirgi {n} tasi ko‘rsatilgan.",
};
