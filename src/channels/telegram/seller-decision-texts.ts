import type { Locale } from "@/core/i18n/locale";

/**
 * Ответы продавцу на его кнопки в Telegram («Принять», «Отклонить», «Выдать»)
 * и на ответ покупателю из уведомления «Клиент ждёт менеджера». Язык —
 * sellerLocale (язык панели, иначе язык магазина). Текст покупателю
 * здесь не живёт: он уходит на языке покупателя из COPY.
 */
export type SellerDecisionTexts = {
  onlyAdmin: string;
  notFound: (id: number) => string;
  rejected: (no: string | number) => string;
  alreadyClosed: (no: string | number, status: string) => string;
  accepted: (no: string | number) => string;
  alreadyAcceptedOrClosed: (no: string | number, status: string) => string;
  noDialog: (no: string | number, platform: string) => string;
  alreadyDelivered: (no: string | number) => string;
  languageAsked: (no: string | number, pending: number) => string;
  delivered: (no: string | number, sent: number) => string;
  partial: (no: string | number, sent: number, failed: number) => string;
  relayNoDialog: string;
  relayNotSent: string;
  relaySent: string;
};

export const SELLER_DECISION: Record<Locale, SellerDecisionTexts> = {
  ru: {
    onlyAdmin: "⛔ Кнопка доступна только продавцу этого магазина.",
    notFound: (id) => `Заказ #${id} не найден.`,
    rejected: (no) => `❌ Заказ #${no} отклонён.`,
    alreadyClosed: (no, st) => `Заказ #${no} уже закрыт (${st}).`,
    accepted: (no) => `✅ Заказ #${no} принят в работу.`,
    alreadyAcceptedOrClosed: (no, st) => `Заказ #${no} уже принят или закрыт (${st}).`,
    noDialog: (no, p) => `Заказ #${no} из ${p}: у покупателя нет диалога для выдачи.`,
    alreadyDelivered: (no) => `Заказ #${no} уже выдан.`,
    languageAsked: (no, n) =>
      `📚 Заказ #${no}: покупателю задан вопрос о языке материалов (${n} поз.) — файлы уйдут после ответа.`,
    delivered: (no, sent) => `✅ Заказ #${no} выдан (${sent} поз.).`,
    partial: (no, s, f) =>
      `⚠️ Заказ #${no}: выдано ${s}, не удалось ${f}. Заказ возвращён в «чек на проверке» — повторите после проверки файлов товара.`,
    relayNoDialog: "Не нашёл диалог покупателя — ответьте в разделе «Чат» панели.",
    relayNotSent: "Не удалось отправить покупателю — попробуйте из раздела «Чат» панели.",
    relaySent: "✅ Ответ отправлен покупателю. Консультант в этом диалоге пока молчит.",
  },
  kk: {
    onlyAdmin: "⛔ Бұл батырма тек осы дүкеннің сатушысына қолжетімді.",
    notFound: (id) => `№${id} тапсырыс табылмады.`,
    rejected: (no) => `❌ №${no} тапсырыс қабылданбады.`,
    alreadyClosed: (no, st) => `№${no} тапсырыс бұрын жабылған (${st}).`,
    accepted: (no) => `✅ №${no} тапсырыс жұмысқа қабылданды.`,
    alreadyAcceptedOrClosed: (no, st) =>
      `№${no} тапсырыс бұрын қабылданған немесе жабылған (${st}).`,
    noDialog: (no, p) => `${p} арнасынан №${no} тапсырыс: беру үшін сатып алушыда диалог жоқ.`,
    alreadyDelivered: (no) => `№${no} тапсырыс бұрын берілген.`,
    languageAsked: (no, n) =>
      `📚 №${no} тапсырыс: сатып алушыға материал тілі туралы сұрақ қойылды (${n} поз.) — файлдар жауаптан кейін жіберіледі.`,
    delivered: (no, sent) => `✅ №${no} тапсырыс берілді (${sent} поз.).`,
    partial: (no, s, f) =>
      `⚠️ №${no} тапсырыс: берілді ${s}, берілмеді ${f}. Тапсырыс «чек тексеруде» күйіне қайтарылды — тауар файлдарын тексергеннен кейін қайталаңыз.`,
    relayNoDialog: "Сатып алушының диалогы табылмады — панельдегі «Чат» бөлімінде жауап беріңіз.",
    relayNotSent: "Сатып алушыға жіберу сәтсіз болды — панельдегі «Чат» бөлімінен көріңіз.",
    relaySent: "✅ Жауап сатып алушыға жіберілді. Консультант бұл диалогта әзірге үнсіз.",
  },
  en: {
    onlyAdmin: "⛔ This button is available only to the seller of this shop.",
    notFound: (id) => `Order #${id} not found.`,
    rejected: (no) => `❌ Order #${no} rejected.`,
    alreadyClosed: (no, st) => `Order #${no} is already closed (${st}).`,
    accepted: (no) => `✅ Order #${no} accepted.`,
    alreadyAcceptedOrClosed: (no, st) => `Order #${no} is already accepted or closed (${st}).`,
    noDialog: (no, p) => `Order #${no} from ${p}: the buyer has no chat to deliver to.`,
    alreadyDelivered: (no) => `Order #${no} has already been delivered.`,
    languageAsked: (no, n) =>
      `📚 Order #${no}: the buyer was asked which language the materials should be in (${n} items) — files go out after the reply.`,
    delivered: (no, sent) => `✅ Order #${no} delivered (${sent} items).`,
    partial: (no, s, f) =>
      `⚠️ Order #${no}: delivered ${s}, failed ${f}. The order is back in “receipt under review” — retry after checking the product files.`,
    relayNoDialog: "Couldn't find the buyer's chat — reply in the “Chat” section of the panel.",
    relayNotSent: "Couldn't send to the buyer — try from the “Chat” section of the panel.",
    relaySent: "✅ Reply sent to the buyer. The consultant stays silent in this chat for now.",
  },
  uz: {
    onlyAdmin: "⛔ Bu tugma faqat ushbu doʻkon sotuvchisi uchun.",
    notFound: (id) => `#${id} buyurtma topilmadi.`,
    rejected: (no) => `❌ #${no} buyurtma rad etildi.`,
    alreadyClosed: (no, st) => `#${no} buyurtma allaqachon yopilgan (${st}).`,
    accepted: (no) => `✅ #${no} buyurtma ishga qabul qilindi.`,
    alreadyAcceptedOrClosed: (no, st) =>
      `#${no} buyurtma allaqachon qabul qilingan yoki yopilgan (${st}).`,
    noDialog: (no, p) => `${p} dan #${no} buyurtma: xaridorda yetkazish uchun dialog yoʻq.`,
    alreadyDelivered: (no) => `#${no} buyurtma allaqachon topshirilgan.`,
    languageAsked: (no, n) =>
      `📚 #${no} buyurtma: xaridorga materiallar tili haqida savol berildi (${n} ta) — fayllar javobdan keyin yuboriladi.`,
    delivered: (no, sent) => `✅ #${no} buyurtma topshirildi (${sent} ta).`,
    partial: (no, s, f) =>
      `⚠️ #${no} buyurtma: topshirildi ${s}, muvaffaqiyatsiz ${f}. Buyurtma «chek tekshiruvda» holatiga qaytarildi — mahsulot fayllarini tekshirgach, qayta urining.`,
    relayNoDialog: "Xaridor dialogi topilmadi — paneldagi «Chat» boʻlimida javob bering.",
    relayNotSent: "Xaridorga yuborib boʻlmadi — paneldagi «Chat» boʻlimidan urinib koʻring.",
    relaySent: "✅ Javob xaridorga yuborildi. Konsultant bu dialogda hozircha jim.",
  },
};
