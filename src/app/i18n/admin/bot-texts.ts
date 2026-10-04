import type { SectionDict } from "../section";

/** Раздел «Тексты бота»: приветствие, «вне часов работы», «спасибо за заказ», «не понял». */
export const ru = {
  "botTexts.nav": "Тексты бота",
  "botTexts.title": "Тексты бота",
  "botTexts.subtitle":
    "Что бот говорит сам. Оставьте поле пустым, и бот скажет стандартный текст. Предпросмотр показывает, как сообщение выглядит у покупателя.",
  "botTexts.channel.telegram": "Telegram",
  "botTexts.channel.instagram": "Instagram",
  "botTexts.channel.whatsapp": "WhatsApp",
  "botTexts.notWired":
    "В Instagram и WhatsApp эти тексты пока не подключены: там бот говорит стандартными словами.",
  "botTexts.key.welcome": "Приветствие",
  "botTexts.key.welcome.hint": "Покупатель нажимает «Старт» и выбирает язык.",
  "botTexts.key.off_hours": "Вне часов работы",
  "botTexts.key.off_hours.hint":
    "Когда покупатель пишет вне рабочих часов (их задаёте ниже), не чаще раза в 6 часов.",
  "botTexts.key.order_thanks": "Спасибо за заказ",
  "botTexts.key.order_thanks.hint":
    "Отдельное сообщение после оформления заказа. Пока своего текста нет, не отправляется.",
  "botTexts.key.not_understood": "Не понял",
  "botTexts.key.not_understood.hint": "Покупатель написал то, что бот не разобрал.",
  "botTexts.vars": "Можно вставить: {vars}",
  "botTexts.var.shop": "{shop} — название магазина",
  "botTexts.var.order": "{order} — номер заказа",
  "botTexts.var.from": "{from} — начало работы",
  "botTexts.var.to": "{to} — конец работы",
  "botTexts.unknownVar": "Нет такой подстановки: {name}. Она останется в тексте как есть.",
  "botTexts.custom": "Свой текст",
  "botTexts.standard": "Стандартный",
  "botTexts.preview": "Так увидит покупатель",
  "botTexts.save": "Сохранить",
  "botTexts.reset": "Вернуть стандартный",
  "botTexts.saved": "Сохранено",
  "botTexts.noCustom": "Стандартный текст",
  "botTexts.hours.title": "Рабочие часы",
  "botTexts.hours.hint":
    "По часовому поясу магазина. Вне этих часов бот отправляет текст «Вне часов работы». Без часов он не отправляется.",
  "botTexts.hours.open": "Начало",
  "botTexts.hours.close": "Конец",
  "botTexts.hours.none": "Не задано",
  "botTexts.hours.save": "Сохранить часы",
  "botTexts.hours.clear": "Убрать часы",
} as const;

export const kk: SectionDict<typeof ru> = {
  "botTexts.nav": "Бот мәтіндері",
  "botTexts.title": "Бот мәтіндері",
  "botTexts.subtitle":
    "Бот өзі айтатын сөздер. Өрісті бос қалдырсаңыз, бот стандартты мәтінді айтады. Алдын ала қарау хабарлама сатып алушыда қалай көрінетінін көрсетеді.",
  "botTexts.channel.telegram": "Telegram",
  "botTexts.channel.instagram": "Instagram",
  "botTexts.channel.whatsapp": "WhatsApp",
  "botTexts.notWired":
    "Instagram мен WhatsApp-та бұл мәтіндер әзірге қосылмаған: онда бот стандартты сөздермен жауап береді.",
  "botTexts.key.welcome": "Сәлемдесу",
  "botTexts.key.welcome.hint": "Сатып алушы «Бастау» батырмасын басып, тілді таңдайды.",
  "botTexts.key.off_hours": "Жұмыс уақытынан тыс",
  "botTexts.key.off_hours.hint":
    "Сатып алушы жұмыс уақытынан тыс жазғанда (уақытты төменде белгілейсіз), 6 сағатта бір реттен жиі емес.",
  "botTexts.key.order_thanks": "Тапсырыс үшін рахмет",
  "botTexts.key.order_thanks.hint":
    "Тапсырыс рәсімделген соң жеке хабарлама. Өз мәтініңіз болмайынша жіберілмейді.",
  "botTexts.key.not_understood": "Түсінбедім",
  "botTexts.key.not_understood.hint": "Сатып алушы бот түсінбеген мәтін жазды.",
  "botTexts.vars": "Қоюға болады: {vars}",
  "botTexts.var.shop": "{shop} — дүкен атауы",
  "botTexts.var.order": "{order} — тапсырыс нөмірі",
  "botTexts.var.from": "{from} — жұмыс басталуы",
  "botTexts.var.to": "{to} — жұмыс аяқталуы",
  "botTexts.unknownVar": "Мұндай ауыстыру жоқ: {name}. Ол мәтінде өзгеріссіз қалады.",
  "botTexts.custom": "Өз мәтіні",
  "botTexts.standard": "Стандартты",
  "botTexts.preview": "Сатып алушы былай көреді",
  "botTexts.save": "Сақтау",
  "botTexts.reset": "Стандарттыны қайтару",
  "botTexts.saved": "Сақталды",
  "botTexts.noCustom": "Стандартты мәтін",
  "botTexts.hours.title": "Жұмыс уақыты",
  "botTexts.hours.hint":
    "Дүкеннің уақыт белдеуі бойынша. Осы сағаттардан тыс бот «Жұмыс уақытынан тыс» мәтінін жібереді. Сағат белгіленбесе, жіберілмейді.",
  "botTexts.hours.open": "Басы",
  "botTexts.hours.close": "Соңы",
  "botTexts.hours.none": "Белгіленбеген",
  "botTexts.hours.save": "Сағаттарды сақтау",
  "botTexts.hours.clear": "Сағаттарды алып тастау",
};

export const en: SectionDict<typeof ru> = {
  "botTexts.nav": "Bot texts",
  "botTexts.title": "Bot texts",
  "botTexts.subtitle":
    "What the bot says on its own. Leave a field empty and the bot uses the standard text. The preview shows how the message looks to the buyer.",
  "botTexts.channel.telegram": "Telegram",
  "botTexts.channel.instagram": "Instagram",
  "botTexts.channel.whatsapp": "WhatsApp",
  "botTexts.notWired":
    "These texts are not connected to Instagram and WhatsApp yet: the bot uses standard words there.",
  "botTexts.key.welcome": "Greeting",
  "botTexts.key.welcome.hint": "The buyer taps Start and picks a language.",
  "botTexts.key.off_hours": "Outside working hours",
  "botTexts.key.off_hours.hint":
    "When a buyer writes outside working hours (set below), at most once every 6 hours.",
  "botTexts.key.order_thanks": "Thank you for the order",
  "botTexts.key.order_thanks.hint":
    "A separate message after checkout. It is not sent until you write your own text.",
  "botTexts.key.not_understood": "Did not understand",
  "botTexts.key.not_understood.hint": "The buyer wrote something the bot could not parse.",
  "botTexts.vars": "You can insert: {vars}",
  "botTexts.var.shop": "{shop} — shop name",
  "botTexts.var.order": "{order} — order number",
  "botTexts.var.from": "{from} — opening time",
  "botTexts.var.to": "{to} — closing time",
  "botTexts.unknownVar": "No such placeholder: {name}. It will stay in the text as is.",
  "botTexts.custom": "Your text",
  "botTexts.standard": "Standard",
  "botTexts.preview": "What the buyer sees",
  "botTexts.save": "Save",
  "botTexts.reset": "Back to standard",
  "botTexts.saved": "Saved",
  "botTexts.noCustom": "Standard text",
  "botTexts.hours.title": "Working hours",
  "botTexts.hours.hint":
    "In the shop's time zone. Outside these hours the bot sends the “Outside working hours” text. Without hours it is not sent.",
  "botTexts.hours.open": "From",
  "botTexts.hours.close": "To",
  "botTexts.hours.none": "Not set",
  "botTexts.hours.save": "Save hours",
  "botTexts.hours.clear": "Remove hours",
};

export const uz: SectionDict<typeof ru> = {
  "botTexts.nav": "Bot matnlari",
  "botTexts.title": "Bot matnlari",
  "botTexts.subtitle":
    "Bot oʻzi aytadigan soʻzlar. Maydonni boʻsh qoldirsangiz, bot standart matnni aytadi. Oldindan koʻrish xabar xaridorda qanday koʻrinishini koʻrsatadi.",
  "botTexts.channel.telegram": "Telegram",
  "botTexts.channel.instagram": "Instagram",
  "botTexts.channel.whatsapp": "WhatsApp",
  "botTexts.notWired":
    "Instagram va WhatsApp uchun bu matnlar hozircha ulanmagan: u yerda bot standart soʻzlar bilan javob beradi.",
  "botTexts.key.welcome": "Salomlashish",
  "botTexts.key.welcome.hint": "Xaridor «Start» tugmasini bosib, tilni tanlaydi.",
  "botTexts.key.off_hours": "Ish vaqtidan tashqari",
  "botTexts.key.off_hours.hint":
    "Xaridor ish vaqtidan tashqari yozganda (vaqtni pastda belgilaysiz), 6 soatda bir martadan koʻp emas.",
  "botTexts.key.order_thanks": "Buyurtma uchun rahmat",
  "botTexts.key.order_thanks.hint":
    "Buyurtma rasmiylashtirilgach alohida xabar. Oʻz matningiz boʻlmaguncha yuborilmaydi.",
  "botTexts.key.not_understood": "Tushunmadim",
  "botTexts.key.not_understood.hint": "Xaridor bot tushunmagan narsa yozdi.",
  "botTexts.vars": "Qoʻyish mumkin: {vars}",
  "botTexts.var.shop": "{shop} — doʻkon nomi",
  "botTexts.var.order": "{order} — buyurtma raqami",
  "botTexts.var.from": "{from} — ish boshlanishi",
  "botTexts.var.to": "{to} — ish tugashi",
  "botTexts.unknownVar": "Bunday almashtirish yoʻq: {name}. U matnda oʻz holicha qoladi.",
  "botTexts.custom": "Oʻz matni",
  "botTexts.standard": "Standart",
  "botTexts.preview": "Xaridor shunday koʻradi",
  "botTexts.save": "Saqlash",
  "botTexts.reset": "Standartga qaytarish",
  "botTexts.saved": "Saqlandi",
  "botTexts.noCustom": "Standart matn",
  "botTexts.hours.title": "Ish vaqti",
  "botTexts.hours.hint":
    "Doʻkonning vaqt mintaqasi boʻyicha. Shu soatlardan tashqari bot «Ish vaqtidan tashqari» matnini yuboradi. Soatlar boʻlmasa, yuborilmaydi.",
  "botTexts.hours.open": "Boshlanishi",
  "botTexts.hours.close": "Tugashi",
  "botTexts.hours.none": "Belgilanmagan",
  "botTexts.hours.save": "Soatlarni saqlash",
  "botTexts.hours.clear": "Soatlarni olib tashlash",
};
