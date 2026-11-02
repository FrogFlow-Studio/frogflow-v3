import type { SellerLang } from "./screens";

/** Строки страницы «Сегодня (v4)» на 4 языках (CLAUDE.md). Тест: заполнены и kk/uz ≠ en. */
export const PANEL_TEXTS = {
  title: {
    ru: "Сегодня (v4)",
    kk: "Бүгін (v4)",
    en: "Today (v4)",
    uz: "Bugun (v4)",
  },
  subtitle: {
    ru: "Дела, которые ждут вас, и что бот сделал сам за 2 дня",
    kk: "Сізді күтіп тұрған істер және бот 2 күнде өзі не істеді",
    en: "Cases waiting for you and what the bot did on its own in 2 days",
    uz: "Sizni kutayotgan ishlar va bot 2 kunda o'zi nima qildi",
  },
  notConnected: {
    ru: "Новая версия платформы ещё не подключена к базе. Ваш магазин работает как раньше.",
    kk: "Платформаның жаңа нұсқасы әлі базаға қосылмаған. Дүкеніңіз бұрынғыдай жұмыс істейді.",
    en: "The new platform version isn't connected to the database yet. Your shop works as before.",
    uz: "Platformaning yangi versiyasi hali bazaga ulanmagan. Do'koningiz avvalgidek ishlaydi.",
  },
  noShop: {
    ru: "Ваш магазин ещё не перенесён в новую версию. Здесь появятся дела, когда перенос будет сделан.",
    kk: "Дүкеніңіз әлі жаңа нұсқаға көшірілмеген. Көшіру жасалғанда істер осында шығады.",
    en: "Your shop hasn't been moved to the new version yet. Cases will appear here once it is.",
    uz: "Do'koningiz hali yangi versiyaga ko'chirilmagan. Ko'chirilgach, ishlar shu yerda chiqadi.",
  },
  empty: {
    ru: "Дел нет — всё под контролем.",
    kk: "Істер жоқ — бәрі бақылауда.",
    en: "No cases — everything is under control.",
    uz: "Ishlar yo'q — hammasi nazoratda.",
  },
  botDid: {
    ru: "Бот сделал сам за 2 дня",
    kk: "Бот 2 күнде өзі жасады",
    en: "The bot did on its own in 2 days",
    uz: "Bot 2 kunda o'zi qildi",
  },
  orders: { ru: "заказов", kk: "тапсырыс", en: "orders", uz: "buyurtma" },
  paid: { ru: "оплачено", kk: "төленді", en: "paid", uz: "to'langan" },
  delivered: { ru: "выдано", kk: "берілді", en: "delivered", uz: "berildi" },
  comments: {
    ru: "ответов на комментарии",
    kk: "пікірге жауап",
    en: "comment replies",
    uz: "izohlarga javob",
  },
  aiLeft: {
    ru: "Осталось ИИ на месяц",
    kk: "Айға қалған ЖИ",
    en: "AI left this month",
    uz: "Oyga qolgan SI",
  },
  due: { ru: "Срок", kk: "Мерзімі", en: "Due", uz: "Muddat" },
  rejectReason: {
    ru: "Почему не пришли? Причина сохранится в истории заказа.",
    kk: "Неге түспеді? Себебі тапсырыс тарихында сақталады.",
    en: "Why wasn't it received? The reason is kept in the order history.",
    uz: "Nega tushmadi? Sabab buyurtma tarixida saqlanadi.",
  },
  confirmAccept: {
    ru: "Подтвердить, что деньги пришли? Заказ станет оплаченным на всю сумму к оплате.",
    kk: "Ақша түскенін растайсыз ба? Тапсырыс төленетін толық сомаға төленген болады.",
    en: "Confirm the money arrived? The order will be marked paid for the full amount due.",
    uz: "Pul tushganini tasdiqlaysizmi? Buyurtma to'lanadigan butun summaga to'langan bo'ladi.",
  },
  already: {
    ru: "Это дело уже решено.",
    kk: "Бұл іс шешіліп қойған.",
    en: "This case is already resolved.",
    uz: "Bu ish allaqachon hal qilingan.",
  },
  nothingDue: {
    ru: "По заказу нечего доплачивать — закройте дело.",
    kk: "Тапсырыс бойынша төлейтін ештеңе жоқ — істі жабыңыз.",
    en: "Nothing is due on this order — close the case.",
    uz: "Buyurtma bo'yicha to'lanadigan narsa yo'q — ishni yoping.",
  },
  reasonRequired: {
    ru: "Напишите причину.",
    kk: "Себебін жазыңыз.",
    en: "Please write a reason.",
    uz: "Sababini yozing.",
  },
  sellerTitle: {
    ru: "ИИ-продавец (v4)",
    kk: "ЖИ-сатушы (v4)",
    en: "AI seller (v4)",
    uz: "SI-sotuvchi (v4)",
  },
  sellerSubtitle: {
    ru: "Условия оплаты и доставки бот берёт только отсюда — ничего не додумывает",
    kk: "Төлем және жеткізу шарттарын бот тек осы жерден алады — ештеңе ойдан қоспайды",
    en: "The bot takes payment and delivery terms only from here and invents nothing",
    uz: "To'lov va yetkazib berish shartlarini bot faqat shu yerdan oladi — hech narsa to'qimaydi",
  },
  fShopName: { ru: "Название магазина", kk: "Дүкен атауы", en: "Shop name", uz: "Do'kon nomi" },
  fAbout: {
    ru: "О магазине и товарах",
    kk: "Дүкен және тауарлар туралы",
    en: "About the shop and products",
    uz: "Do'kon va mahsulotlar haqida",
  },
  fPayment: {
    ru: "Условия оплаты",
    kk: "Төлем шарттары",
    en: "Payment terms",
    uz: "To'lov shartlari",
  },
  fDelivery: {
    ru: "Условия доставки и выдачи",
    kk: "Жеткізу және беру шарттары",
    en: "Delivery terms",
    uz: "Yetkazib berish shartlari",
  },
  fTone: {
    ru: "Как говорить с покупателем",
    kk: "Сатып алушымен қалай сөйлесу керек",
    en: "How to talk to buyers",
    uz: "Xaridor bilan qanday gaplashish",
  },
  fSpam: {
    ru: "Стоп-слова для комментариев (по одному в строке): на такие комментарии бот не отвечает",
    kk: "Пікірлерге арналған тыйым сөздер (әр жолға біреуден): мұндай пікірлерге бот жауап бермейді",
    en: "Comment stop words (one per line): the bot doesn't reply to such comments",
    uz: "Izohlar uchun taqiqlangan so'zlar (har qatorda bittadan): bunday izohlarga bot javob bermaydi",
  },
  aiLimit: {
    ru: "Лимит ИИ на месяц (задаёт тариф)",
    kk: "Айлық ЖИ лимиті (тариф белгілейді)",
    en: "Monthly AI limit (set by the plan)",
    uz: "Oylik SI limiti (tarif belgilaydi)",
  },
  save: { ru: "Сохранить", kk: "Сақтау", en: "Save", uz: "Saqlash" },
  saved: { ru: "Сохранено.", kk: "Сақталды.", en: "Saved.", uz: "Saqlandi." },
  stale: {
    ru: "Пока вы редактировали, настройки сохранил кто-то другой. Обновите страницу и внесите правку снова.",
    kk: "Сіз өңдеп жатқанда баптауларды басқа біреу сақтады. Бетті жаңартып, түзетуді қайта енгізіңіз.",
    en: "Someone else saved the settings while you were editing. Reload the page and make your change again.",
    uz: "Siz tahrirlayotganda sozlamalarni boshqa kishi saqladi. Sahifani yangilang va o'zgarishni qayta kiriting.",
  },
} satisfies Record<string, Record<SellerLang, string>>;

export type PanelKey = keyof typeof PANEL_TEXTS;
export const panelT = (lang: SellerLang) => (k: PanelKey) => PANEL_TEXTS[k][lang];
