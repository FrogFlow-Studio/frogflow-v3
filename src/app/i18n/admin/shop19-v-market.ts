import type { SectionDict } from "../section";

/** Площадка FrogFlow (В6): согласие магазина в «Настройки». */
export const ru = {
  "settings.market.title": "Площадка FrogFlow",
  "settings.market.intro":
    "Общий каталог магазинов FrogFlow, где покупатели находят магазины сами. На площадке показываются только название, категория, город и ссылка на вашу витрину; заказы, суммы и покупатели туда не попадают. По умолчанию выключено. Пока площадка не открыта, выключатель только сохраняет ваше согласие.",
  "settings.market.on": "Показывать на площадке FrogFlow",
  "settings.market.terms":
    "Включая, вы соглашаетесь с правилами площадки. Новый магазин появляется на площадке после одобрения оператором; оператор может скрыть магазин.",
  "settings.market.state.off": "Выключено: магазина нет на площадке.",
  "settings.market.state.hidden":
    "Оператор платформы скрыл магазин с площадки. Остальное работает.",
  "settings.market.reason": "Причина: {reason}",
  "settings.market.ownerOnly": "Согласие меняет владелец магазина.",
  "err.marketplace.oldPlatform": "Площадка доступна магазинам на новой платформе.",
  "settings.market.state.visible": "Включено и одобрено: магазин показывается на площадке.",
  "settings.market.state.pending":
    "Согласие дано, ждём одобрения оператора: пока магазина на площадке нет.",
  "settings.market.category": "Категория на площадке (пусто — ниша магазина: {def})",
  "settings.market.city": "Город",
  "settings.market.save": "Сохранить",
} as const;

export const kk: SectionDict<typeof ru> = {
  "settings.market.title": "FrogFlow алаңы",
  "settings.market.intro":
    "FrogFlow дүкендерінің ортақ каталогы: сатып алушылар дүкенді өздері табады. Алаңда тек атауы, санаты, қаласы және витринаға сілтеме көрсетіледі; тапсырыстар, сомалар және сатып алушылар түспейді. Әдепкіде өшірулі. Алаң ашылғанша қосқыш тек келісіміңізді сақтайды.",
  "settings.market.on": "FrogFlow алаңында көрсету",
  "settings.market.terms":
    "Қосу арқылы алаң ережелерімен келісесіз. Жаңа дүкен оператор мақұлдағаннан кейін алаңда пайда болады; оператор дүкенді жасыра алады.",
  "settings.market.state.off": "Өшірулі: дүкен алаңда жоқ.",
  "settings.market.state.hidden":
    "Платформа операторы дүкенді алаңнан жасырды. Қалғаны жұмыс істейді.",
  "settings.market.reason": "Себебі: {reason}",
  "settings.market.ownerOnly": "Келісімді дүкен иесі өзгертеді.",
  "err.marketplace.oldPlatform": "Алаң жаңа платформадағы дүкендерге қолжетімді.",
  "settings.market.state.visible": "Қосулы және мақұлданған: дүкен алаңда көрсетіледі.",
  "settings.market.state.pending":
    "Келісім берілді, оператор мақұлдауын күтеміз: әзірге дүкен алаңда жоқ.",
  "settings.market.category": "Алаңдағы санат (бос — дүкен ниші: {def})",
  "settings.market.city": "Қала",
  "settings.market.save": "Сақтау",
};

export const en: SectionDict<typeof ru> = {
  "settings.market.title": "FrogFlow marketplace",
  "settings.market.intro":
    "The shared FrogFlow shop catalogue where buyers discover shops. Only the name, category, city and a link to your storefront are shown; orders, amounts and buyers never reach it. Off by default. Until the marketplace opens, the switch only stores your consent.",
  "settings.market.on": "Show on the FrogFlow marketplace",
  "settings.market.terms":
    "By switching on you accept the marketplace rules. A new shop appears after the operator approves it; the operator may hide a shop.",
  "settings.market.state.off": "Off: the shop is not on the marketplace.",
  "settings.market.state.hidden":
    "The platform operator has hidden the shop from the marketplace. Everything else works.",
  "settings.market.reason": "Reason: {reason}",
  "settings.market.ownerOnly": "Only the shop owner can change the consent.",
  "err.marketplace.oldPlatform": "The marketplace is available to shops on the new platform.",
  "settings.market.state.visible": "On and approved: the shop is shown on the marketplace.",
  "settings.market.state.pending":
    "Consent given, waiting for operator approval: the shop is not on the marketplace yet.",
  "settings.market.category": "Marketplace category (empty — the shop’s niche: {def})",
  "settings.market.city": "City",
  "settings.market.save": "Save",
};

export const uz: SectionDict<typeof ru> = {
  "settings.market.title": "FrogFlow maydonchasi",
  "settings.market.intro":
    "FrogFlow do‘konlarining umumiy katalogi: xaridorlar do‘konni o‘zlari topadi. Faqat nom, toifa, shahar va vitrinaga havola ko‘rsatiladi; buyurtmalar, summalar va xaridorlar tushmaydi. Odatda o‘chirilgan. Maydoncha ochilguncha tugma faqat roziligingizni saqlaydi.",
  "settings.market.on": "FrogFlow maydonchasida ko‘rsatish",
  "settings.market.terms":
    "Yoqish orqali maydoncha qoidalariga rozilik bildirasiz. Yangi do‘kon operator tasdiqlagach paydo bo‘ladi; operator do‘konni yashirishi mumkin.",
  "settings.market.state.off": "O‘chirilgan: do‘kon maydonchada yo‘q.",
  "settings.market.state.hidden":
    "Platforma operatori do‘konni maydonchadan yashirdi. Qolgani ishlaydi.",
  "settings.market.reason": "Sababi: {reason}",
  "settings.market.ownerOnly": "Rozilikni do‘kon egasi o‘zgartiradi.",
  "err.marketplace.oldPlatform": "Maydoncha yangi platformadagi do‘konlarga ochiq.",
  "settings.market.state.visible": "Yoqilgan va tasdiqlangan: do‘kon maydonchada ko‘rsatiladi.",
  "settings.market.state.pending":
    "Rozilik berilgan, operator tasdig‘i kutilmoqda: hozircha do‘kon maydonchada yo‘q.",
  "settings.market.category": "Maydonchadagi toifa (bo‘sh — do‘kon yo‘nalishi: {def})",
  "settings.market.city": "Shahar",
  "settings.market.save": "Saqlash",
};
