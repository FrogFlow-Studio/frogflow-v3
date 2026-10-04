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
  "crmlog.retry": "Повторить",
  "crmlog.retryHint":
    "Событие уйдёт ещё раз с тем же event_id — ваша CRM может отбросить дубль. Таймаут и ответ 5xx сами не повторяются: событие могло дойти.",
  "crmlog.retried": "Событие поставлено на повтор: уйдёт в ближайшую минуту.",
  "err.admin.crmPingWait": "Проверять вебхук можно не чаще раза в 10 секунд.",
  "err.admin.crmRetryGone":
    "Это событие уже нельзя повторить: оно доставлено или его нет в очереди.",
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
  "crmlog.retry": "Қайталау",
  "crmlog.retryHint":
    "Оқиға сол event_id-мен тағы бір рет кетеді — CRM-іңіз телнұсқаны қабылдамай тастай алады. Тайм-аут және 5xx жауабы өздігінен қайталанбайды: оқиға жетіп қалған болуы мүмкін.",
  "crmlog.retried": "Оқиға қайталауға қойылды: жақын минутта кетеді.",
  "err.admin.crmPingWait": "Вебхукті 10 секундта бір реттен жиі тексеруге болмайды.",
  "err.admin.crmRetryGone":
    "Бұл оқиғаны енді қайталауға болмайды: ол жеткізілген немесе кезекте жоқ.",
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
  "crmlog.retry": "Retry",
  "crmlog.retryHint":
    "The event is sent again with the same event_id, so your CRM can drop the duplicate. A timeout or a 5xx reply is not retried automatically: the event may have arrived.",
  "crmlog.retried": "The event is queued for a retry: it goes out within a minute.",
  "err.admin.crmPingWait": "The webhook can be checked once every 10 seconds at most.",
  "err.admin.crmRetryGone":
    "This event can no longer be retried: it was delivered or is not in the queue.",
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
  "crmlog.retry": "Qayta yuborish",
  "crmlog.retryHint":
    "Hodisa o‘sha event_id bilan yana yuboriladi — CRM dublikatni tashlab yuborishi mumkin. Taym-aut va 5xx javobi o‘zi qayta yuborilmaydi: hodisa yetib borgan bo‘lishi mumkin.",
  "crmlog.retried": "Hodisa qayta yuborishga qo‘yildi: bir daqiqa ichida ketadi.",
  "err.admin.crmPingWait": "Vebhukni 10 soniyada bir martadan ko‘p tekshirib bo‘lmaydi.",
  "err.admin.crmRetryGone":
    "Bu hodisani endi qayta yuborib bo‘lmaydi: u yetkazilgan yoki navbatda yo‘q.",
};
