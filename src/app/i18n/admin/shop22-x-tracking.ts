import type { SectionDict } from "../section";

/** Трек-номер посылки из админки (Х5): поле на карточке заказа и ответы сервера. */
export const ru = {
  "order.track.title": "Отправлено почтой или СДЭК",
  "order.track.hint":
    "Номер СДЭК (10 цифр) или Казпочты (KZ…) — покупателю уйдёт номер и ссылка. Номер другого перевозчика уйдёт текстом без ссылки.",
  "order.track.placeholder": "Трек-номер или ссылка",
  "order.track.send": "Отправить трек",
  "msg.orders.trackBad":
    "Не похоже на трек-номер: нужны 6–30 знаков (буквы, цифры, дефис) или ссылка https://…",
  "msg.orders.trackNeedReady":
    "Трек можно указать у собранного заказа с доставкой: нажмите «Собран» и повторите.",
  "msg.orders.trackAlready": "Этот трек-номер уже отправлен покупателю — второго сообщения нет.",
  "msg.orders.trackSent": "Заказ отправлен, покупателю ушло: {label}.",
  "msg.orders.trackNotSent":
    "Заказ отмечен отправленным, но сообщение покупателю не ушло: у заказа нет чата или почты. Повторно не отправляем.",
} as const;
export const kk: SectionDict<typeof ru> = {
  "order.track.title": "Пошта немесе СДЭК арқылы жөнелтілді",
  "order.track.hint":
    "СДЭК (10 сан) немесе Казпочта (KZ…) нөмірі — сатып алушыға нөмір мен сілтеме барады. Басқа тасымалдаушы нөмірі сілтемесіз мәтінмен барады.",
  "order.track.placeholder": "Трек-нөмір немесе сілтеме",
  "order.track.send": "Тректі жіберу",
  "msg.orders.trackBad":
    "Трек-нөмірге ұқсамайды: 6–30 таңба (әріп, сан, сызықша) немесе https://… сілтеме керек",
  "msg.orders.trackNeedReady":
    "Тректі жеткізуі бар жиналған тапсырысқа көрсетуге болады: «Жиналды» басып, қайталаңыз.",
  "msg.orders.trackAlready": "Бұл трек-нөмір сатып алушыға жіберілген — екінші хабарлама жоқ.",
  "msg.orders.trackSent": "Тапсырыс жөнелтілді, сатып алушыға барды: {label}.",
  "msg.orders.trackNotSent":
    "Тапсырыс жөнелтілді деп белгіленді, бірақ сатып алушыға хабарлама бармады: тапсырыста чат не пошта жоқ. Қайта жібермейміз.",
};
export const en: SectionDict<typeof ru> = {
  "order.track.title": "Sent by post or CDEK",
  "order.track.hint":
    "A CDEK (10 digits) or Kazpost (KZ…) number — the buyer gets the number and a link. Another carrier's number goes as plain text without a link.",
  "order.track.placeholder": "Tracking number or link",
  "order.track.send": "Send tracking",
  "msg.orders.trackBad":
    "That does not look like a tracking number: 6–30 characters (letters, digits, hyphen) or an https://… link",
  "msg.orders.trackNeedReady":
    "Tracking can be added to a packed order with delivery: press “Packed” and try again.",
  "msg.orders.trackAlready":
    "This tracking number was already sent to the buyer — no second message.",
  "msg.orders.trackSent": "Order shipped, the buyer was sent: {label}.",
  "msg.orders.trackNotSent":
    "The order is marked shipped, but the buyer message was not sent: the order has no chat or email. We do not resend.",
};
export const uz: SectionDict<typeof ru> = {
  "order.track.title": "Pochta yoki CDEK orqali joʻnatildi",
  "order.track.hint":
    "CDEK (10 raqam) yoki Kazpochta (KZ…) raqami — xaridorga raqam va havola boradi. Boshqa tashuvchi raqami havolasiz matn bilan boradi.",
  "order.track.placeholder": "Trek-raqam yoki havola",
  "order.track.send": "Trekni yuborish",
  "msg.orders.trackBad":
    "Trek-raqamga oʻxshamaydi: 6–30 belgi (harf, raqam, defis) yoki https://… havola kerak",
  "msg.orders.trackNeedReady":
    "Trekni yetkazib berishli yigʻilgan buyurtmaga kiritish mumkin: «Yigʻildi» ni bosib, qayta urinib koʻring.",
  "msg.orders.trackAlready": "Bu trek-raqam xaridorga allaqachon yuborilgan — ikkinchi xabar yoʻq.",
  "msg.orders.trackSent": "Buyurtma joʻnatildi, xaridorga yuborildi: {label}.",
  "msg.orders.trackNotSent":
    "Buyurtma joʻnatilgan deb belgilandi, lekin xaridorga xabar bormadi: buyurtmada chat yoki pochta yoʻq. Qayta yubormaymiz.",
};
