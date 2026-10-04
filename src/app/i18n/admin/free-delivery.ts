import type { SectionDict } from "../section";

/** Бесплатная доставка от суммы (Д3): настройка порога. */
export const ru = {
  "settings.freeDelivery.title": "Бесплатная доставка",
  "settings.freeDelivery.intro":
    "Когда товары в корзине после скидок и баллов стоят не меньше порога, доставка бесплатная, и покупатель видит в корзине, сколько осталось добрать. Подарочный сертификат на порог не влияет: это оплата, а не скидка.",
  "settings.freeDelivery.general": "Общий порог, {cur}",
  "settings.freeDelivery.hint":
    "0 — без бесплатной доставки. Порог считается по товарам, без доставки.",
  "settings.freeDelivery.zone": "Порог для района «{name}», {cur}",
  "settings.freeDelivery.zonePlaceholder": "как общий",
} as const;

export const kk: SectionDict<typeof ru> = {
  "settings.freeDelivery.title": "Тегін жеткізу",
  "settings.freeDelivery.intro":
    "Себеттегі тауарлар жеңілдіктер мен ұпайлардан кейін шектен кем болмаса, жеткізу тегін, ал сатып алушы себетте қанша қосу керегін көреді. Сыйлық сертификаты шекке әсер етпейді: ол жеңілдік емес, төлем.",
  "settings.freeDelivery.general": "Жалпы шек, {cur}",
  "settings.freeDelivery.hint":
    "0 — тегін жеткізу жоқ. Шек тауарлар бойынша есептеледі, жеткізусіз.",
  "settings.freeDelivery.zone": "«{name}» ауданы үшін шек, {cur}",
  "settings.freeDelivery.zonePlaceholder": "жалпы сияқты",
};

export const en: SectionDict<typeof ru> = {
  "settings.freeDelivery.title": "Free delivery",
  "settings.freeDelivery.intro":
    "When the goods in the cart, after discounts and points, cost at least the threshold, delivery is free and the buyer sees in the cart how much more to add. A gift certificate does not affect the threshold: it is a payment, not a discount.",
  "settings.freeDelivery.general": "General threshold, {cur}",
  "settings.freeDelivery.hint":
    "0 — no free delivery. The threshold counts goods only, without delivery.",
  "settings.freeDelivery.zone": "Threshold for the “{name}” area, {cur}",
  "settings.freeDelivery.zonePlaceholder": "same as general",
};

export const uz: SectionDict<typeof ru> = {
  "settings.freeDelivery.title": "Bepul yetkazish",
  "settings.freeDelivery.intro":
    "Savatdagi tovarlar chegirma va ballardan keyin chegaradan kam bo‘lmasa, yetkazish bepul bo‘ladi, xaridor esa savatda yana qancha qo‘shish kerakligini ko‘radi. Sovg‘a sertifikati chegaraga ta’sir qilmaydi: u chegirma emas, to‘lov.",
  "settings.freeDelivery.general": "Umumiy chegara, {cur}",
  "settings.freeDelivery.hint":
    "0 — bepul yetkazish yo‘q. Chegara faqat tovarlar bo‘yicha hisoblanadi, yetkazishsiz.",
  "settings.freeDelivery.zone": "«{name}» hududi uchun chegara, {cur}",
  "settings.freeDelivery.zonePlaceholder": "umumiy kabi",
};
