import type { SectionDict } from "../section";

/** Возвраты по заказу: кнопка и форма в карточке, статус, сообщения и ошибки сервера. */
export const ru = {
  "orders.status.refunded": "Возврат",
  "orders.tab.refunded": "Возвраты",
  "refund.button": "Возврат",
  "refund.title": "Возврат денег",
  "refund.amount": "Сумма возврата",
  "refund.available": "Можно вернуть: {sum}",
  "refund.all": "Всю сумму",
  "refund.reason": "Причина — увидит покупатель",
  "refund.restock": "Вернуть товар на склад",
  "refund.notify": "Сообщить покупателю",
  "refund.submit": "Оформить возврат",
  "refund.cancel": "Отмена",
  "refund.confirm": "Вернуть {sum} по заказу #{no}? Отменить возврат нельзя.",
  "refund.done": "Возвращено: {sum}",
  "refund.hint":
    "Деньги покупателю возвращаете вы сами (перевод, касса). Здесь возврат фиксируется: вычитается из выручки, при полном возврате баллы и коды возвращаются.",
  "msg.refund.full": "Возврат {sum} по заказу #{no} оформлен",
  "msg.refund.partial": "Частичный возврат {sum} по заказу #{no} оформлен",
  "err.refund.notRefundable": "По заказу в этом статусе денег не получено — возвращать нечего",
  "err.refund.overRefundable": "Можно вернуть не больше {remaining}",
  "err.refund.changed": "Заказ только что изменился — обновите страницу",
};

export const kk: SectionDict<typeof ru> = {
  "orders.status.refunded": "Қайтарым",
  "orders.tab.refunded": "Қайтарымдар",
  "refund.button": "Қайтарым",
  "refund.title": "Ақшаны қайтару",
  "refund.amount": "Қайтарым сомасы",
  "refund.available": "Қайтаруға болады: {sum}",
  "refund.all": "Бүкіл сома",
  "refund.reason": "Себебі — сатып алушы көреді",
  "refund.restock": "Тауарды қоймаға қайтару",
  "refund.notify": "Сатып алушыға хабарлау",
  "refund.submit": "Қайтарымды рәсімдеу",
  "refund.cancel": "Болдырмау",
  "refund.confirm":
    "#{no} тапсырыс бойынша {sum} қайтарылсын ба? Қайтарымды болдырмау мүмкін емес.",
  "refund.done": "Қайтарылды: {sum}",
  "refund.hint":
    "Ақшаны сатып алушыға өзіңіз қайтарасыз (аударым, касса). Мұнда қайтарым тіркеледі: түсімнен шегеріледі, толық қайтарымда ұпайлар мен кодтар қайтарылады.",
  "msg.refund.full": "#{no} тапсырыс бойынша {sum} қайтарымы рәсімделді",
  "msg.refund.partial": "#{no} тапсырыс бойынша {sum} ішінара қайтарымы рәсімделді",
  "err.refund.notRefundable":
    "Бұл мәртебедегі тапсырыс бойынша ақша алынбаған — қайтаратын ештеңе жоқ",
  "err.refund.overRefundable": "{remaining} артық қайтаруға болмайды",
  "err.refund.changed": "Тапсырыс жаңа ғана өзгерді — бетті жаңартыңыз",
};

export const en: SectionDict<typeof ru> = {
  "orders.status.refunded": "Refunded",
  "orders.tab.refunded": "Refunds",
  "refund.button": "Refund",
  "refund.title": "Refund",
  "refund.amount": "Refund amount",
  "refund.available": "Refundable: {sum}",
  "refund.all": "Full amount",
  "refund.reason": "Reason — the customer will see it",
  "refund.restock": "Return items to stock",
  "refund.notify": "Notify the customer",
  "refund.submit": "Record refund",
  "refund.cancel": "Cancel",
  "refund.confirm": "Refund {sum} for order #{no}? A refund can't be undone.",
  "refund.done": "Refunded: {sum}",
  "refund.hint":
    "You return the money yourself (transfer, cash). This records the refund: it is subtracted from revenue, and a full refund returns points and codes.",
  "msg.refund.full": "Refund of {sum} for order #{no} recorded",
  "msg.refund.partial": "Partial refund of {sum} for order #{no} recorded",
  "err.refund.notRefundable":
    "No money was received for an order in this status — nothing to refund",
  "err.refund.overRefundable": "You can refund at most {remaining}",
  "err.refund.changed": "The order has just changed — refresh the page",
};

export const uz: SectionDict<typeof ru> = {
  "orders.status.refunded": "Qaytarildi",
  "orders.tab.refunded": "Qaytarishlar",
  "refund.button": "Qaytarish",
  "refund.title": "Pulni qaytarish",
  "refund.amount": "Qaytarish summasi",
  "refund.available": "Qaytarish mumkin: {sum}",
  "refund.all": "To‘liq summa",
  "refund.reason": "Sabab — xaridor ko‘radi",
  "refund.restock": "Tovarni omborga qaytarish",
  "refund.notify": "Xaridorga xabar berish",
  "refund.submit": "Qaytarishni rasmiylashtirish",
  "refund.cancel": "Bekor qilish",
  "refund.confirm":
    "#{no} buyurtma bo‘yicha {sum} qaytarilsinmi? Qaytarishni bekor qilib bo‘lmaydi.",
  "refund.done": "Qaytarildi: {sum}",
  "refund.hint":
    "Pulni xaridorga o‘zingiz qaytarasiz (o‘tkazma, kassa). Bu yerda qaytarish qayd etiladi: tushumdan ayiriladi, to‘liq qaytarishda ballar va kodlar qaytariladi.",
  "msg.refund.full": "#{no} buyurtma bo‘yicha {sum} qaytarish rasmiylashtirildi",
  "msg.refund.partial": "#{no} buyurtma bo‘yicha {sum} qisman qaytarish rasmiylashtirildi",
  "err.refund.notRefundable":
    "Bu holatdagi buyurtma bo‘yicha pul olinmagan — qaytaradigan narsa yo‘q",
  "err.refund.overRefundable": "{remaining} dan ortiq qaytarib bo‘lmaydi",
  "err.refund.changed": "Buyurtma hozirgina o‘zgardi — sahifani yangilang",
};
