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
  /** Шаг статуса физического заказа с кнопки под уведомлением. */
  stepDone: (no: string | number, step: StepName) => string;
  stepStale: (no: string | number, status: string) => string;
  /** Кнопка «Написать покупателю»: как ответить (метку в конце ставит код). */
  writePrompt: (no: string | number) => string;
  writeNoChat: (no: string | number) => string;
  /** Окно канала закрыто: WhatsApp — шаблоном, Instagram — только другим путём. */
  writeWindowClosed: (platform: string) => string;
  /** Отправка могла дойти (обрыв, 5xx): повторно не шлём, сверить в приложении. */
  writeUnknown: string;
  writeNotSent: string;
  writeSent: (no: string | number) => string;
};

export type StepName = "work" | "ready" | "shipped" | "done";

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
    stepDone: (no, step) =>
      `${{ work: "🧑‍🍳 Заказ #" + no + ": в работе.", ready: "📦 Заказ #" + no + ": собран.", shipped: "🚚 Заказ #" + no + ": отправлен, покупателю написали.", done: "✅ Заказ #" + no + ": выдан, покупателю написали." }[step]}`,
    stepStale: (no, st) => `Статус заказа #${no} уже изменился (${st}) — обновите уведомление.`,
    writePrompt: (no) =>
      `✉️ Покупателю по заказу #${no}: ответьте на это сообщение свайпом — текст уйдёт ему в тот же канал.`,
    writeNoChat: (no) =>
      `Заказ #${no}: у покупателя нет чата с ботом — напишите ему по контакту из заказа.`,
    writeWindowClosed: (p) =>
      p === "whatsapp"
        ? "Не отправлено: окно WhatsApp закрыто (прошло больше 24 часов с последнего сообщения покупателя). Ответьте одобренным шаблоном в приложении WhatsApp или в «Чате» панели."
        : "Не отправлено: окно Instagram закрыто (прошло больше 24 часов с последнего сообщения покупателя), шаблонов там нет. Напишите по другому контакту покупателя.",
    writeUnknown:
      "Неизвестно, дошло ли сообщение (обрыв связи): проверьте переписку в приложении. Повторно не отправляю, чтобы не задвоить.",
    writeNotSent:
      "Не удалось отправить покупателю — попробуйте позже или напишите по контакту из заказа.",
    writeSent: (no) => `✅ Сообщение по заказу #${no} отправлено покупателю.`,
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
    stepDone: (no, step) =>
      `${{ work: "🧑‍🍳 №" + no + " тапсырыс: жұмыста.", ready: "📦 №" + no + " тапсырыс: жиналды.", shipped: "🚚 №" + no + " тапсырыс: жөнелтілді, сатып алушыға хабарланды.", done: "✅ №" + no + " тапсырыс: берілді, сатып алушыға хабарланды." }[step]}`,
    stepStale: (no, st) => `№${no} тапсырыс күйі бұрын өзгерген (${st}) — хабарламаны жаңартыңыз.`,
    writePrompt: (no) =>
      `✉️ №${no} тапсырыс бойынша сатып алушыға: осы хабарламаға свайппен жауап беріңіз — мәтін сол арнаға кетеді.`,
    writeNoChat: (no) =>
      `№${no} тапсырыс: сатып алушының боттағы чаты жоқ — тапсырыстағы байланыс арқылы жазыңыз.`,
    writeWindowClosed: (p) =>
      p === "whatsapp"
        ? "Жіберілмеді: WhatsApp терезесі жабық (сатып алушының соңғы хабарынан 24 сағаттан астам өтті). WhatsApp қолданбасында немесе панельдегі «Чатта» бекітілген үлгімен жауап беріңіз."
        : "Жіберілмеді: Instagram терезесі жабық (сатып алушының соңғы хабарынан 24 сағаттан астам өтті), онда үлгілер жоқ. Сатып алушының басқа байланысы арқылы жазыңыз.",
    writeUnknown:
      "Хабарлама жеткені белгісіз (байланыс үзілді): қолданбада жазбаны тексеріңіз. Қосарланбау үшін қайта жібермеймін.",
    writeNotSent:
      "Сатып алушыға жіберу сәтсіз болды — кейінірек көріңіз немесе тапсырыстағы байланыс арқылы жазыңыз.",
    writeSent: (no) => `✅ №${no} тапсырыс бойынша хабарлама сатып алушыға жіберілді.`,
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
    stepDone: (no, step) =>
      `${{ work: "🧑‍🍳 Order #" + no + ": in progress.", ready: "📦 Order #" + no + ": packed.", shipped: "🚚 Order #" + no + ": shipped, the buyer was notified.", done: "✅ Order #" + no + ": handed over, the buyer was notified." }[step]}`,
    stepStale: (no, st) =>
      `Order #${no} status has already changed (${st}) — refresh the notification.`,
    writePrompt: (no) =>
      `✉️ To the buyer of order #${no}: reply to this message (swipe) — the text goes to them in the same channel.`,
    writeNoChat: (no) =>
      `Order #${no}: the buyer has no chat with the bot — contact them via the details in the order.`,
    writeWindowClosed: (p) =>
      p === "whatsapp"
        ? "Not sent: the WhatsApp window is closed (more than 24 hours since the buyer's last message). Reply with an approved template in the WhatsApp app or in the panel's “Chat”."
        : "Not sent: the Instagram window is closed (more than 24 hours since the buyer's last message) and Instagram has no templates. Use another contact for the buyer.",
    writeUnknown:
      "Unknown whether the message got through (connection dropped): check the chat in the app. I won't resend, to avoid a duplicate.",
    writeNotSent: "Couldn't send to the buyer — try later or use the contact in the order.",
    writeSent: (no) => `✅ Your message about order #${no} was sent to the buyer.`,
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
    stepDone: (no, step) =>
      `${{ work: "🧑‍🍳 #" + no + " buyurtma: ishda.", ready: "📦 #" + no + " buyurtma: yigʻildi.", shipped: "🚚 #" + no + " buyurtma: joʻnatildi, xaridorga xabar berildi.", done: "✅ #" + no + " buyurtma: topshirildi, xaridorga xabar berildi." }[step]}`,
    stepStale: (no, st) =>
      `#${no} buyurtma holati allaqachon oʻzgargan (${st}) — xabarni yangilang.`,
    writePrompt: (no) =>
      `✉️ #${no} buyurtma xaridoriga: shu xabarga svayp bilan javob bering — matn oʻsha kanalga ketadi.`,
    writeNoChat: (no) =>
      `#${no} buyurtma: xaridorning botda chati yoʻq — buyurtmadagi aloqa orqali yozing.`,
    writeWindowClosed: (p) =>
      p === "whatsapp"
        ? "Yuborilmadi: WhatsApp oynasi yopiq (xaridorning oxirgi xabaridan 24 soatdan koʻp oʻtdi). WhatsApp ilovasida yoki paneldagi «Chat»da tasdiqlangan shablon bilan javob bering."
        : "Yuborilmadi: Instagram oynasi yopiq (xaridorning oxirgi xabaridan 24 soatdan koʻp oʻtdi), unda shablonlar yoʻq. Xaridorning boshqa aloqasi orqali yozing.",
    writeUnknown:
      "Xabar yetib borgani nomaʼlum (aloqa uzildi): ilovada yozishmani tekshiring. Takrorlanmasligi uchun qayta yubormayman.",
    writeNotSent:
      "Xaridorga yuborib boʻlmadi — keyinroq urining yoki buyurtmadagi aloqadan foydalaning.",
    writeSent: (no) => `✅ #${no} buyurtma boʻyicha xabar xaridorga yuborildi.`,
  },
};
