import type { Locale } from "@/core/i18n/locale";

/**
 * Фразы Direct из вечернего среза AATeach 11.10: почта по желанию, чек
 * текстом, повторное «Купить», отмена свежего заказа. Четыре языка.
 */
export type EveningCopy = {
  /** На «вацап», «сюда», «не надо почту» в ответ на вопрос о почте. */
  filesHere: string;
  /** Чек текстом принят и ушёл продавцу на проверку. */
  textReceiptTaken: (no: number) => string;
  /** Повторное «Купить», заказ ждёт чек по реквизитам. */
  alreadyPlacedProof: (no: number) => string;
  /** Повторное «Купить», заказ ждёт оплату по ссылке. */
  alreadyPlacedLink: (no: number) => string;
  /** «Отмена» сразу после оформления. */
  orderCancelled: (no: number) => string;
};

export const EVENING_COPY: Record<Locale, EveningCopy> = {
  ru: {
    filesHere:
      "Хорошо! Файлы придут сюда, в переписку, после проверки чека. Почта — по желанию: если захотите копию на почту, просто напишите адрес.",
    textReceiptTaken: (no) =>
      `✅ Принял чек по заказу #${no}, передаю на проверку. Файлы придут сюда после подтверждения.`,
    alreadyPlacedProof: (no) =>
      `Заказ #${no} уже оформлен — реквизиты в сообщении выше. Жду чек об оплате.`,
    alreadyPlacedLink: (no) => `Заказ #${no} уже оформлен — ссылка на оплату в сообщении выше.`,
    orderCancelled: (no) => `Заказ #${no} отменён.`,
  },
  kk: {
    filesHere:
      "Жақсы! Файлдар чек тексерілгеннен кейін осында, хат алмасуға келеді. Пошта — қалауыңызша: көшірмесі поштаға керек болса, мекенжайды жазыңыз.",
    textReceiptTaken: (no) =>
      `✅ #${no} тапсырыс бойынша чекті қабылдадым, тексеруге жіберемін. Файлдар растағаннан кейін осында келеді.`,
    alreadyPlacedProof: (no) =>
      `#${no} тапсырыс рәсімделіп қойған — деректемелер жоғарыдағы хабарламада. Төлем чегін күтемін.`,
    alreadyPlacedLink: (no) =>
      `#${no} тапсырыс рәсімделіп қойған — төлем сілтемесі жоғарыдағы хабарламада.`,
    orderCancelled: (no) => `#${no} тапсырыс тоқтатылды.`,
  },
  en: {
    filesHere:
      "Sure! The files will come here, in this chat, once the receipt is checked. Email is optional: if you'd like a copy by email, just send the address.",
    textReceiptTaken: (no) =>
      `✅ Got the receipt for order #${no}, passing it on for checking. The files will come here once it's confirmed.`,
    alreadyPlacedProof: (no) =>
      `Order #${no} is already placed — payment details are in the message above. Waiting for your receipt.`,
    alreadyPlacedLink: (no) =>
      `Order #${no} is already placed — the payment link is in the message above.`,
    orderCancelled: (no) => `Order #${no} has been cancelled.`,
  },
  uz: {
    filesHere:
      "Yaxshi! Fayllar chek tekshirilgach shu yerga, yozishmaga keladi. Pochta — ixtiyoriy: nusxasi pochtaga kerak bo‘lsa, manzilni yozing.",
    textReceiptTaken: (no) =>
      `✅ #${no} buyurtma bo‘yicha chekni qabul qildim, tekshiruvga yuboraman. Fayllar tasdiqlangach shu yerga keladi.`,
    alreadyPlacedProof: (no) =>
      `#${no} buyurtma allaqachon rasmiylashtirilgan — rekvizitlar yuqoridagi xabarda. To‘lov chekini kutyapman.`,
    alreadyPlacedLink: (no) =>
      `#${no} buyurtma allaqachon rasmiylashtirilgan — to‘lov havolasi yuqoridagi xabarda.`,
    orderCancelled: (no) => `#${no} buyurtma bekor qilindi.`,
  },
};
