import type { SectionDict } from "../section";

/** Площадка FrogFlow (В6): согласие магазина в «Настройки». */
export const ru = {
  "settings.market.title": "Площадка FrogFlow",
  "settings.market.intro":
    "Общий каталог FrogFlow (frogflow.tech/market), где покупатели находят магазины и товары сами. На площадке показываются название, категория и город магазина, а также товары витрины с фото и ценой; покупка проходит на вашей витрине. Заказы, суммы и покупатели на площадку не попадают. По умолчанию выключено.",
  "settings.market.on": "Показывать на площадке FrogFlow",
  "settings.market.terms":
    "Включая, вы соглашаетесь с правилами площадки. Новый магазин появляется на площадке после одобрения оператором; оператор может скрыть магазин.",
  "settings.market.rules": "Правила площадки",
  "settings.asBuyer": "Моя витрина как покупатель",
  "settings.asBuyer.hint": "Откроется ваша витрина в новой вкладке так, как её видят покупатели.",
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
  "settings.market.state.no_catalog":
    "Включено и одобрено, но каталог витрины закрыт: подключите модуль «Публичная веб-витрина» или «Telegram Mini App», иначе ссылка с площадки никуда не ведёт. Пока магазина на площадке нет.",
  "settings.market.city": "Город",
  "settings.market.save": "Сохранить",
} as const;

export const kk: SectionDict<typeof ru> = {
  "settings.market.title": "FrogFlow алаңы",
  "settings.market.intro":
    "FrogFlow ортақ каталогы (frogflow.tech/market): сатып алушылар дүкендер мен тауарларды өздері табады. Алаңда дүкеннің атауы, санаты, қаласы және витрина тауарлары фотосы мен бағасымен көрсетіледі; сатып алу сіздің витринаңызда өтеді. Тапсырыстар, сомалар және сатып алушылар алаңға түспейді. Әдепкіде өшірулі.",
  "settings.market.on": "FrogFlow алаңында көрсету",
  "settings.market.terms":
    "Қосу арқылы алаң ережелерімен келісесіз. Жаңа дүкен оператор мақұлдағаннан кейін алаңда пайда болады; оператор дүкенді жасыра алады.",
  "settings.market.rules": "Алаң ережелері",
  "settings.asBuyer": "Менің витринам сатып алушы көзімен",
  "settings.asBuyer.hint": "Витринаңыз жаңа бетте сатып алушылар көретіндей ашылады.",
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
  "settings.market.state.no_catalog":
    "Қосулы және мақұлданған, бірақ витрина каталогы жабық: «Ашық веб-витрина» немесе «Telegram Mini App» модулін қосыңыз, әйтпесе алаңдағы сілтеме ешқайда апармайды. Әзірге дүкен алаңда жоқ.",
  "settings.market.city": "Қала",
  "settings.market.save": "Сақтау",
};

export const en: SectionDict<typeof ru> = {
  "settings.market.title": "FrogFlow marketplace",
  "settings.market.intro":
    "The shared FrogFlow catalogue (frogflow.tech/market) where buyers discover shops and products. It shows your shop name, category and city, plus your storefront products with photos and prices; the purchase happens on your storefront. Orders, amounts and buyers never reach the marketplace. Off by default.",
  "settings.market.on": "Show on the FrogFlow marketplace",
  "settings.market.terms":
    "By switching on you accept the marketplace rules. A new shop appears after the operator approves it; the operator may hide a shop.",
  "settings.market.rules": "Marketplace rules",
  "settings.asBuyer": "My storefront as a buyer",
  "settings.asBuyer.hint": "Your storefront opens in a new tab the way buyers see it.",
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
  "settings.market.state.no_catalog":
    "On and approved, but your storefront catalogue is closed: enable the “Public web storefront” or “Telegram Mini App” module, otherwise the marketplace link leads nowhere. The shop is not on the marketplace yet.",
  "settings.market.city": "City",
  "settings.market.save": "Save",
};

export const uz: SectionDict<typeof ru> = {
  "settings.market.title": "FrogFlow maydonchasi",
  "settings.market.intro":
    "FrogFlow umumiy katalogi (frogflow.tech/market): xaridorlar do‘kon va mahsulotlarni o‘zlari topadi. Do‘kon nomi, toifasi, shahri hamda vitrina mahsulotlari surati va narxi bilan ko‘rsatiladi; xarid sizning vitrinangizda bo‘ladi. Buyurtmalar, summalar va xaridorlar maydonchaga tushmaydi. Odatda o‘chirilgan.",
  "settings.market.on": "FrogFlow maydonchasida ko‘rsatish",
  "settings.market.terms":
    "Yoqish orqali maydoncha qoidalariga rozilik bildirasiz. Yangi do‘kon operator tasdiqlagach paydo bo‘ladi; operator do‘konni yashirishi mumkin.",
  "settings.market.rules": "Maydon qoidalari",
  "settings.asBuyer": "Vitrinam xaridor ko‘zi bilan",
  "settings.asBuyer.hint": "Vitrinangiz yangi oynada xaridorlar ko‘radigandek ochiladi.",
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
  "settings.market.state.no_catalog":
    "Yoqilgan va tasdiqlangan, lekin vitrina katalogi yopiq: «Ochiq veb-vitrina» yoki «Telegram Mini App» modulini ulang, aks holda maydonchadagi havola hech qayerga olib bormaydi. Hozircha do‘kon maydonchada yo‘q.",
  "settings.market.city": "Shahar",
  "settings.market.save": "Saqlash",
};
