import type { SectionDict } from "../section";

/** «Похожие материалы» в разделе «Рассылки» (core/similar). */
export const ru = {
  "similar.title": "Похожие материалы",
  "similar.enabled": "включено",
  "similar.intro":
    "Через N дней после покупки бот предложит покупателю до трёх товаров из тех же категорий, которых он ещё не покупал. Один раз на заказ, только в Telegram и только днём; отписавшимся и заблокированным не пишет, в сутки — не больше потолка автосообщений.",
  "similar.days": "Через, дней",
  "similar.text": "Текст сообщения",
  "similar.textHint": "{name} — имя покупателя. Товары придут кнопками под текстом.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "similar.title": "Ұқсас материалдар",
  "similar.enabled": "қосулы",
  "similar.intro":
    "Сатып алғаннан кейін N күннен соң бот сатып алушыға сол санаттардан ол әлі алмаған үш тауарға дейін ұсынады. Әр тапсырысқа бір рет, тек Telegram-да және тек күндіз; жазылымнан бас тартқандар мен бұғатталғандарға жазбайды, тәулігіне автохабарлама шегінен артық жазбайды.",
  "similar.days": "Неше күннен кейін",
  "similar.text": "Хабарлама мәтіні",
  "similar.textHint":
    "{name} — сатып алушының аты. Тауарлар мәтіннің астында батырма болып келеді.",
};

export const en: SectionDict<typeof ru> = {
  "similar.title": "Similar materials",
  "similar.enabled": "on",
  "similar.intro":
    "N days after a purchase the bot offers the customer up to three products from the same categories that they have not bought yet. Once per order, Telegram only and daytime only; never to unsubscribed or blocked customers, and within the daily auto-message cap.",
  "similar.days": "After, days",
  "similar.text": "Message text",
  "similar.textHint": "{name} is the customer's name. Products come as buttons under the text.",
};

export const uz: SectionDict<typeof ru> = {
  "similar.title": "Oʻxshash materiallar",
  "similar.enabled": "yoqilgan",
  "similar.intro":
    "Xariddan N kun oʻtgach bot xaridorga u hali olmagan, oʻsha toifalardagi uchtagacha mahsulotni taklif qiladi. Har bir buyurtmaga bir marta, faqat Telegramda va faqat kunduzi; obunani bekor qilganlar va bloklanganlarga yozmaydi, sutkada avtoxabarlar chegarasidan ortiq yozmaydi.",
  "similar.days": "Necha kundan keyin",
  "similar.text": "Xabar matni",
  "similar.textHint": "{name} — xaridor ismi. Mahsulotlar matn ostida tugma boʻlib keladi.",
};
