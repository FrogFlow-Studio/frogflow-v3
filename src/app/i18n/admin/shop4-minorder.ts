import type { SectionDict } from "../section";

/** Минимальная сумма заказа (В4): карточка в настройках магазина. */
export const ru = {
  "settings.minOrder.title": "Минимальная сумма заказа",
  "settings.minOrder.intro":
    "Бот, сайт и магазин в Instagram/WhatsApp не дадут оформить заказ на меньшую сумму и подскажут, сколько добрать. Считается сумма корзины до скидок.",
  "settings.minOrder.label": "Минимальная сумма, {cur}",
  "settings.minOrder.hint": "0 — без минимума. Бесплатные товары минимум не блокирует.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "settings.minOrder.title": "Тапсырыстың ең аз сомасы",
  "settings.minOrder.intro":
    "Бот, сайт және Instagram/WhatsApp дүкені одан аз сомаға тапсырыс рәсімдеуге рұқсат бермейді және қанша қосу керегін айтады. Жеңілдікке дейінгі себет сомасы есептеледі.",
  "settings.minOrder.label": "Ең аз сома, {cur}",
  "settings.minOrder.hint": "0 — шексіз. Тегін тауарларды ең аз сома тоқтатпайды.",
};

export const en: SectionDict<typeof ru> = {
  "settings.minOrder.title": "Minimum order amount",
  "settings.minOrder.intro":
    "The bot, the website and the Instagram/WhatsApp shop will not let a buyer order for less and will say how much to add. The cart total before discounts is used.",
  "settings.minOrder.label": "Minimum amount, {cur}",
  "settings.minOrder.hint": "0 — no minimum. Free products are never blocked by it.",
};

export const uz: SectionDict<typeof ru> = {
  "settings.minOrder.title": "Buyurtmaning minimal summasi",
  "settings.minOrder.intro":
    "Bot, sayt va Instagram/WhatsApp doʻkoni bundan kam summaga buyurtma berishga yoʻl qoʻymaydi va qancha qoʻshish kerakligini aytadi. Chegirmagacha boʻlgan savat summasi hisobga olinadi.",
  "settings.minOrder.label": "Minimal summa, {cur}",
  "settings.minOrder.hint": "0 — minimumsiz. Bepul mahsulotlarni minimum toʻsmaydi.",
};
