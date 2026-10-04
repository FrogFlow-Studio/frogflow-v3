import type { SectionDict } from "../section";

/** Главная админки: «Что сделать сегодня» (А2). */
export const ru = {
  "today.title": "Что сделать сегодня",
  "today.empty": "На сегодня задач нет: всё разобрано.",
  "today.unknown": "не удалось определить",
  "today.retry": "Обновить",
  "today.receipts": "Чеки на проверке",
  "today.newOrders": "Новые заказы: принять в работу",
  "today.ready": "Готовы к выдаче",
  "today.dialogs": "Непрочитанные сообщения покупателей",
  "today.tickets": "Открытые обращения",
  "today.lowStock": "Товары на исходе",
  "today.rev1": "Выручка за сутки",
  "today.rev7": "Выручка за неделю",
} as const;

export const kk: SectionDict<typeof ru> = {
  "today.title": "Бүгін не істеу керек",
  "today.empty": "Бүгінге тапсырма жоқ: бәрі қарастырылған.",
  "today.unknown": "анықтау мүмкін болмады",
  "today.retry": "Жаңарту",
  "today.receipts": "Тексеруді күтіп тұрған чектер",
  "today.newOrders": "Жаңа тапсырыстар: жұмысқа қабылдау",
  "today.ready": "Беруге дайын",
  "today.dialogs": "Сатып алушылардың оқылмаған хабарлары",
  "today.tickets": "Ашық өтініштер",
  "today.lowStock": "Қалдығы азайған тауарлар",
  "today.rev1": "Тәулік түсімі",
  "today.rev7": "Апта түсімі",
};

export const en: SectionDict<typeof ru> = {
  "today.title": "To do today",
  "today.empty": "Nothing to do today: everything is handled.",
  "today.unknown": "could not be determined",
  "today.retry": "Refresh",
  "today.receipts": "Receipts awaiting review",
  "today.newOrders": "New orders: accept into work",
  "today.ready": "Ready for handover",
  "today.dialogs": "Unread buyer messages",
  "today.tickets": "Open support requests",
  "today.lowStock": "Products running low",
  "today.rev1": "Revenue, last 24 hours",
  "today.rev7": "Revenue, last 7 days",
};

export const uz: SectionDict<typeof ru> = {
  "today.title": "Bugun nima qilish kerak",
  "today.empty": "Bugunga vazifa yo‘q: hammasi ko‘rib chiqilgan.",
  "today.unknown": "aniqlab bo‘lmadi",
  "today.retry": "Yangilash",
  "today.receipts": "Tekshiruvni kutayotgan cheklar",
  "today.newOrders": "Yangi buyurtmalar: ishga qabul qilish",
  "today.ready": "Topshirishga tayyor",
  "today.dialogs": "O‘qilmagan xaridor xabarlari",
  "today.tickets": "Ochiq murojaatlar",
  "today.lowStock": "Qoldig‘i kamayayotgan tovarlar",
  "today.rev1": "Sutkalik tushum",
  "today.rev7": "Haftalik tushum",
};
