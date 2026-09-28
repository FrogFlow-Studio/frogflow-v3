import type { SectionDict } from "../section";

/** Удаление магазина владельцем с холдом 30 дней (app/admin/deletion.server). */
export const ru = {
  "deletion.title": "Удалить магазин",
  "deletion.hint":
    "Магазин сразу встанет на паузу: бот ответит сообщением паузы, витрина закроется. 30 дней его можно восстановить, потом он уйдёт в архив, а фото, файлы и чеки удалятся. Заказы сохранятся для учёта.",
  "deletion.start": "Удалить магазин…",
  "deletion.confirmLabel": "Для подтверждения введите название магазина: {name}",
  "deletion.submit": "Удалить через 30 дней",
  "deletion.banner": "Магазин на паузе и будет удалён {date}. До этого его можно восстановить.",
  "deletion.restore": "Восстановить магазин",
  "err.deletion.confirm": "Введите название магазина точно так, как оно указано в настройках",
};

export const kk: SectionDict<typeof ru> = {
  "deletion.title": "Дүкенді жою",
  "deletion.hint":
    "Дүкен бірден үзіліске қойылады: бот үзіліс хабарламасымен жауап береді, витрина жабылады. 30 күн ішінде оны қалпына келтіруге болады, кейін ол мұрағатқа түседі, ал фото, файлдар мен чектер жойылады. Тапсырыстар есеп үшін сақталады.",
  "deletion.start": "Дүкенді жою…",
  "deletion.confirmLabel": "Растау үшін дүкен атауын енгізіңіз: {name}",
  "deletion.submit": "30 күннен кейін жою",
  "deletion.banner":
    "Дүкен үзілісте және {date} жойылады. Оған дейін оны қалпына келтіруге болады.",
  "deletion.restore": "Дүкенді қалпына келтіру",
  "err.deletion.confirm": "Дүкен атауын баптауларда көрсетілгендей дәл енгізіңіз",
};

export const en: SectionDict<typeof ru> = {
  "deletion.title": "Delete the shop",
  "deletion.hint":
    "The shop is paused right away: the bot answers with the pause message and the storefront closes. For 30 days it can be restored; then it is archived and photos, files and receipts are deleted. Orders are kept for accounting.",
  "deletion.start": "Delete the shop…",
  "deletion.confirmLabel": "To confirm, type the shop name: {name}",
  "deletion.submit": "Delete in 30 days",
  "deletion.banner":
    "The shop is paused and will be deleted on {date}. Until then you can restore it.",
  "deletion.restore": "Restore the shop",
  "err.deletion.confirm": "Type the shop name exactly as it appears in the settings",
};

export const uz: SectionDict<typeof ru> = {
  "deletion.title": "Doʻkonni oʻchirish",
  "deletion.hint":
    "Doʻkon darhol pauzaga qoʻyiladi: bot pauza xabari bilan javob beradi, vitrina yopiladi. 30 kun ichida uni tiklash mumkin, keyin u arxivga oʻtadi, foto, fayllar va cheklar oʻchiriladi. Buyurtmalar hisob uchun saqlanadi.",
  "deletion.start": "Doʻkonni oʻchirish…",
  "deletion.confirmLabel": "Tasdiqlash uchun doʻkon nomini kiriting: {name}",
  "deletion.submit": "30 kundan keyin oʻchirish",
  "deletion.banner": "Doʻkon pauzada va {date} oʻchiriladi. Unga qadar uni tiklash mumkin.",
  "deletion.restore": "Doʻkonni tiklash",
  "err.deletion.confirm": "Doʻkon nomini sozlamalardagidek aniq kiriting",
};
