import type { SectionDict } from "../section";

/** Сообщество авторов (С6): страница автора и взаимные рекомендации. */
export const ru = {
  "settings.community.rec.title": "Рекомендации магазинов",
  "settings.community.rec.intro":
    "Отметьте до {max} магазинов, которые рекомендуете. Рекомендация показывается на витринах и на страницах авторов только тогда, когда магазин отметил вас в ответ. Уберёте отметку — рекомендация сразу пропадёт у обоих.",
  "settings.community.rec.page": "Открыть мою страницу автора",
  "settings.community.rec.none": "Других авторов в сообществе пока нет.",
  "settings.community.rec.mutual": "взаимно",
  "err.community.recommendMax": "Рекомендовать можно не больше пяти магазинов.",
};
export const kk: SectionDict<typeof ru> = {
  "settings.community.rec.title": "Дүкендерді ұсыну",
  "settings.community.rec.intro":
    "Ұсынатын {max} дүкенге дейін белгілеңіз. Ұсыныс витриналарда және авторлар беттерінде дүкен сізді жауап ретінде белгілегенде ғана көрінеді. Белгіні алсаңыз, ұсыныс екеуінде де бірден жоғалады.",
  "settings.community.rec.page": "Менің автор бетімді ашу",
  "settings.community.rec.none": "Қауымдастықта басқа авторлар әзірге жоқ.",
  "settings.community.rec.mutual": "өзара",
  "err.community.recommendMax": "Бестен артық дүкенді ұсынуға болмайды.",
};
export const en: SectionDict<typeof ru> = {
  "settings.community.rec.title": "Shop recommendations",
  "settings.community.rec.intro":
    "Tick up to {max} shops you recommend. A recommendation shows on storefronts and author pages only when that shop has ticked you back. Untick and it disappears for both at once.",
  "settings.community.rec.page": "Open my author page",
  "settings.community.rec.none": "There are no other authors in the community yet.",
  "settings.community.rec.mutual": "mutual",
  "err.community.recommendMax": "You can recommend at most five shops.",
};
export const uz: SectionDict<typeof ru> = {
  "settings.community.rec.title": "Doʻkonlarni tavsiya qilish",
  "settings.community.rec.intro":
    "Tavsiya qiladigan {max} tagacha doʻkonni belgilang. Tavsiya vitrinalarda va muallif sahifalarida faqat u doʻkon sizni ham belgilaganda koʻrinadi. Belgini olsangiz, tavsiya ikkalasida ham darhol yoʻqoladi.",
  "settings.community.rec.page": "Muallif sahifamni ochish",
  "settings.community.rec.none": "Hamjamiyatda boshqa mualliflar hozircha yoʻq.",
  "settings.community.rec.mutual": "oʻzaro",
  "err.community.recommendMax": "Beshtadan koʻp doʻkonni tavsiya qilib boʻlmaydi.",
};
