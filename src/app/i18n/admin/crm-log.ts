import type { SectionDict } from "../section";

/** Журнал доставки вебхуков (карточка «Интеграция с CRM», И1). */
export const ru = {
  "crmlog.title": "Журнал доставки",
  "crmlog.hint":
    "Последние 100 отправок: событие, заказ, ответ вашего сервера и время. Тело события и секрет сюда не пишутся.",
  "crmlog.empty": "Отправок пока не было.",
  "crmlog.col.when": "Когда",
  "crmlog.col.event": "Событие",
  "crmlog.col.order": "Заказ",
  "crmlog.col.result": "Ответ",
  "crmlog.ok": "принято ({status})",
  "crmlog.http": "отказ: код {status}",
  "crmlog.timeout": "таймаут: сервер не ответил за 10 секунд",
  "crmlog.network": "обрыв: до сервера не достучались",
  "crmlog.blocked": "адрес запрещён",
  "crmlog.event.ping": "проверка",
} as const;

export const kk: SectionDict<typeof ru> = {
  "crmlog.title": "Жеткізу журналы",
  "crmlog.hint":
    "Соңғы 100 жіберу: оқиға, тапсырыс, серверіңіздің жауабы және уақыты. Оқиға мәтіні мен құпия сөз мұнда жазылмайды.",
  "crmlog.empty": "Әзірге жіберу болған жоқ.",
  "crmlog.col.when": "Қашан",
  "crmlog.col.event": "Оқиға",
  "crmlog.col.order": "Тапсырыс",
  "crmlog.col.result": "Жауап",
  "crmlog.ok": "қабылданды ({status})",
  "crmlog.http": "бас тартты: код {status}",
  "crmlog.timeout": "тайм-аут: сервер 10 секундта жауап бермеді",
  "crmlog.network": "үзіліс: серверге жете алмадық",
  "crmlog.blocked": "мекенжайға тыйым салынған",
  "crmlog.event.ping": "тексеру",
};

export const en: SectionDict<typeof ru> = {
  "crmlog.title": "Delivery log",
  "crmlog.hint":
    "The last 100 deliveries: event, order, your server's reply and time. The event body and the secret are never stored here.",
  "crmlog.empty": "Nothing has been sent yet.",
  "crmlog.col.when": "When",
  "crmlog.col.event": "Event",
  "crmlog.col.order": "Order",
  "crmlog.col.result": "Reply",
  "crmlog.ok": "accepted ({status})",
  "crmlog.http": "rejected: code {status}",
  "crmlog.timeout": "timeout: no reply within 10 seconds",
  "crmlog.network": "connection lost: could not reach the server",
  "crmlog.blocked": "address not allowed",
  "crmlog.event.ping": "check",
};

export const uz: SectionDict<typeof ru> = {
  "crmlog.title": "Yetkazish jurnali",
  "crmlog.hint":
    "Oxirgi 100 ta yuborish: hodisa, buyurtma, serveringiz javobi va vaqti. Hodisa matni va maxfiy kalit bu yerga yozilmaydi.",
  "crmlog.empty": "Hozircha hech narsa yuborilmagan.",
  "crmlog.col.when": "Qachon",
  "crmlog.col.event": "Hodisa",
  "crmlog.col.order": "Buyurtma",
  "crmlog.col.result": "Javob",
  "crmlog.ok": "qabul qilindi ({status})",
  "crmlog.http": "rad etildi: kod {status}",
  "crmlog.timeout": "taym-aut: server 10 soniyada javob bermadi",
  "crmlog.network": "uzilish: serverga yetib bo'lmadi",
  "crmlog.blocked": "manzilga ruxsat yo'q",
  "crmlog.event.ping": "tekshiruv",
};
