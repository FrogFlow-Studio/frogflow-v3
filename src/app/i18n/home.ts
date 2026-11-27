/**
 * Словарь новой главной `/` (Enveriq): русский — источник, kk/en/uz — полные
 * переводы, каждый ключ обязателен. Общие с нишами и статьями строки (тарифы,
 * три шага, переписка в демо, чек Kaspi) остаются в `./landing`, здесь —
 * только то, что есть лишь на главной. Имя продукта — из `landing/brand.ts`
 * через `{brand}`, чтобы смена имени не требовала правки переводов.
 */
import type { Locale } from "@/core/i18n/locale";

const ru = {
  "meta.title": "Бот для продаж в Instagram, Telegram и WhatsApp с оплатой Kaspi — {brand}",
  "meta.description":
    "{brand} отвечает покупателям, принимает заказы и оплату Kaspi или картой и сам выдаёт товар. Запуск за вечер, без программиста. {days} дней бесплатно.",
  "nav.features": "Возможности",
  "nav.pay": "Оплата",
  "nav.how": "Как начать",
  "nav.pricing": "Цены",
  "nav.faq": "Вопросы",
  "nav.login": "Войти",
  "nav.language": "Язык",
  "nav.cta": "Попробовать бесплатно",
  "hero.eyebrow": "Для продавцов Казахстана, Кыргызстана и Узбекистана",
  "hero.titleHead": "Ваш магазин в Instagram, Telegram и WhatsApp",
  "hero.titleTail": "продаёт сам",
  "hero.lead":
    "Бот отвечает покупателям, показывает каталог, принимает оплату Kaspi или картой и выдаёт товар. Вам остаётся подтвердить деньги одной кнопкой, а с кассой не нужно и её.",
  "hero.ctaSignup": "Попробовать {days} дней бесплатно",
  "hero.ctaLogin": "Войти в панель магазина",
  "hero.ctaDemo": "Написать демо-боту",
  "hero.r1": "Без оплаты на старте",
  "hero.r2": "Запуск за вечер, без программиста",
  "hero.r3": "Бот на 4 языках: ru, kk, en, uz",
  "proof.title": "Уже продают с {brand}",
  "proof.total": "заказов выдано покупателям через платформу",
  "proof.asOf": "По данным платформы на {date}",
  "feat.title": "Всё для продаж в мессенджерах — в одном месте",
  "feat.sub":
    "Вместо отдельных сервисов для бота, ответов в директе, оплаты, сайта и рассылок — одна панель и одна подписка.",
  "feat.shop.title": "Магазин в трёх мессенджерах",
  "feat.shop.text":
    "Каталог, корзина и заказ прямо в Telegram, WhatsApp и Instagram. Один каталог и одни цены на все каналы.",
  "feat.ai.title": "ИИ-консультант в Direct",
  "feat.ai.text":
    "Отвечает по вашему прайсу и анкете днём и ночью, с комментария пишет покупателю в директ, сложное передаёт менеджеру с готовой заявкой.",
  "feat.pay.title": "Оплата Kaspi и картой",
  "feat.pay.text":
    "Реквизиты Kaspi и проверка чека, Робокасса и Продамус, задаток и оплата при получении.",
  "feat.deliver.title": "Выдача без вас",
  "feat.deliver.text":
    "Файл, доступ в закрытый канал или уроки курса приходят покупателю сразу после подтверждения оплаты.",
  "feat.site.title": "Витрина по ссылке",
  "feat.site.text":
    "Страница магазина для шапки профиля: товары, корзина и оплата без сайта и разработчика.",
  "feat.panel.title": "Панель продавца с телефона",
  "feat.panel.text":
    "Заказы, покупатели, рассылки, промокоды и аналитика. Выгрузка в Excel и роли для команды.",
  "feat.tiers": "Что входит в каждый тариф — в разделе «Цены».",
  "feat.niches": "Готовые решения:",
  "pay.title": "Оплата Kaspi или картой — без ручной рутины",
  "pay.sub":
    "Начните с перевода на Kaspi, ничего не подписывая: бот сам проверит чек. Появится договор с кассой — оплату будет подтверждать она, и кнопка не понадобится.",
  "pay.checksTitle": "Что бот сверяет в чеке Kaspi",
  "compare.title": "Один сервис вместо пяти",
  "compare.sub":
    "Обычно продавец платит за несколько сервисов и переносит заказы между ними руками.",
  "compare.usual": "Обычно",
  "compare.r1": "Конструктор бота для Telegram",
  "compare.r2": "Автоответы в Instagram Direct",
  "compare.r3": "Приём оплаты и проверка чеков",
  "compare.r4": "Сайт-визитка для шапки профиля",
  "compare.r5": "Таблица заказов, CRM и рассылки",
  "compare.one": "С {brand}",
  "compare.oneTitle": "Одна панель для всего",
  "compare.oneText":
    "Покупатели, заказы и оплаты из всех каналов в одном месте. Одна подписка от {price} в месяц.",
  "faq.title": "Частые вопросы",
  "faq.countries.q": "Работает ли в Кыргызстане и Узбекистане?",
  "faq.countries.a":
    "Да. Для каждой страны свои цены, валюта и реквизиты, бот говорит на русском, казахском, английском и узбекском. Где нет Kaspi, покупатель платит переводом на карту и присылает чек.",
  "faq.confirm.q": "Бот сам подтверждает оплату?",
  "faq.confirm.a":
    "С договором Робокассы или Продамуса — да: касса сообщает об оплате, и товар уходит сам. При переводе на Kaspi бот проверяет чек, а поступление денег подтверждаете вы одной кнопкой: в ваш банк бот не заходит.",
  "faq.rename.q": "{brand} и FrogFlow — это одно и то же?",
  "faq.rename.a":
    "Да. {brand} — новое имя платформы FrogFlow, продукт студии FrogFlow Studio. Боты, магазины, цены и вход в панель остаются прежними.",
  "final.title": "Запустите продажи в мессенджерах на этой неделе",
  "final.text":
    "Создайте кабинет за 5 минут, добавьте товары и отправьте покупателям ссылку на бота. Первые {days} дней бесплатно.",
  "final.contacts": "Остались вопросы? Напишите нам, поможем с запуском.",
  "final.cta": "Открыть магазин",
  "final.login": "У меня уже есть магазин",
  "footer.tagline": "Продажи, оплата и ИИ-консультант в мессенджерах",
  "footer.formerly": "Раньше — FrogFlow",
  "footer.login": "Вход для продавца",
  "chat.avatar": "А",
};

export type HomeKey = keyof typeof ru;
type Dict = Record<HomeKey, string>;

/** Все ключи словаря: тест проверяет, что каждый переведён на каждый язык. */
export const HOME_KEYS = Object.keys(ru) as HomeKey[];

const kk: Dict = {
  "meta.title": "Instagram, Telegram және WhatsApp-қа сату боты, Kaspi арқылы төлем — {brand}",
  "meta.description":
    "{brand} сатып алушыларға жауап береді, тапсырыс пен Kaspi немесе карта арқылы төлем қабылдайды және тауарды өзі береді. Бір кеште іске қосу, бағдарламашысыз. {days} күн тегін.",
  "nav.features": "Мүмкіндіктер",
  "nav.pay": "Төлем",
  "nav.how": "Қалай бастау",
  "nav.pricing": "Бағалар",
  "nav.faq": "Сұрақтар",
  "nav.login": "Кіру",
  "nav.language": "Тіл",
  "nav.cta": "Тегін байқап көру",
  "hero.eyebrow": "Қазақстан, Қырғызстан және Өзбекстан сатушыларына",
  "hero.titleHead": "Instagram, Telegram және WhatsApp-тағы дүкеніңіз",
  "hero.titleTail": "өзі сатады",
  "hero.lead":
    "Бот сатып алушыларға жауап береді, каталогты көрсетеді, Kaspi немесе карта арқылы төлем қабылдайды және тауарды береді. Сізге ақшаны бір батырмамен растау ғана қалады, ал кассамен оның да керегі жоқ.",
  "hero.ctaSignup": "{days} күн тегін байқап көру",
  "hero.ctaLogin": "Дүкен панеліне кіру",
  "hero.ctaDemo": "Демо-ботқа жазу",
  "hero.r1": "Бастауда төлем жоқ",
  "hero.r2": "Бір кеште іске қосу, бағдарламашысыз",
  "hero.r3": "Бот 4 тілде: ru, kk, en, uz",
  "proof.title": "{brand}-пен сатып жатыр",
  "proof.total": "тапсырыс платформа арқылы сатып алушыларға берілді",
  "proof.asOf": "Платформа деректері бойынша, {date}",
  "feat.title": "Мессенджерлердегі сауданың бәрі — бір жерде",
  "feat.sub":
    "Бот, директтегі жауаптар, төлем, сайт және таратылымдар үшін бөлек сервистердің орнына — бір панель және бір жазылым.",
  "feat.shop.title": "Үш мессенджердегі дүкен",
  "feat.shop.text":
    "Каталог, себет және тапсырыс тікелей Telegram, WhatsApp және Instagram-да. Барлық арнаға бір каталог және бір баға.",
  "feat.ai.title": "Direct-тегі ЖИ-кеңесші",
  "feat.ai.text":
    "Прайсыңыз бен сауалнамаңыз бойынша күні-түні жауап береді, пікірден кейін сатып алушыға директке жазады, күрделі сұрақты дайын өтінішпен менеджерге береді.",
  "feat.pay.title": "Kaspi және карта арқылы төлем",
  "feat.pay.text":
    "Kaspi деректемелері мен чекті тексеру, Робокасса және Продамус, кепілақы және алғанда төлеу.",
  "feat.deliver.title": "Сізсіз беру",
  "feat.deliver.text":
    "Файл, жабық арнаға кіру немесе курс сабақтары төлем расталған бойда сатып алушыға келеді.",
  "feat.site.title": "Сілтеме бойынша витрина",
  "feat.site.text":
    "Профиль тақырыбына арналған дүкен беті: тауарлар, себет және төлем сайтсыз және әзірлеушісіз.",
  "feat.panel.title": "Телефоннан сатушы панелі",
  "feat.panel.text":
    "Тапсырыстар, сатып алушылар, таратылымдар, промокодтар және аналитика. Excel-ге жүктеу және командаға рөлдер.",
  "feat.tiers": "Әр тарифке не кіретіні — «Бағалар» бөлімінде.",
  "feat.niches": "Дайын шешімдер:",
  "pay.title": "Kaspi немесе карта арқылы төлем — қолмен әурешіліксіз",
  "pay.sub":
    "Ештеңеге қол қоймай, Kaspi-ге аударымнан бастаңыз: бот чекті өзі тексереді. Кассамен келісімшарт пайда болғанда төлемді сол растайды, батырма қажет болмайды.",
  "pay.checksTitle": "Бот Kaspi чегінде нені салыстырады",
  "compare.title": "Бес сервистің орнына біреу",
  "compare.sub":
    "Әдетте сатушы бірнеше сервиске төлейді және тапсырыстарды олардың арасында қолмен көшіреді.",
  "compare.usual": "Әдетте",
  "compare.r1": "Telegram-ға бот конструкторы",
  "compare.r2": "Instagram Direct-те автожауаптар",
  "compare.r3": "Төлем қабылдау және чектерді тексеру",
  "compare.r4": "Профиль тақырыбына сайт-визитка",
  "compare.r5": "Тапсырыстар кестесі, CRM және таратылымдар",
  "compare.one": "{brand}-пен",
  "compare.oneTitle": "Бәріне бір панель",
  "compare.oneText":
    "Барлық арналардан сатып алушылар, тапсырыстар мен төлемдер бір жерде. Айына {price} бастап бір жазылым.",
  "faq.title": "Жиі қойылатын сұрақтар",
  "faq.countries.q": "Қырғызстан мен Өзбекстанда жұмыс істей ме?",
  "faq.countries.a":
    "Иә. Әр елге өз бағасы, валютасы және деректемелері, бот орыс, қазақ, ағылшын және өзбек тілдерінде сөйлейді. Kaspi жоқ жерде сатып алушы картаға аударым жасап, чек жібереді.",
  "faq.confirm.q": "Бот төлемді өзі растай ма?",
  "faq.confirm.a":
    "Робокасса немесе Продамус келісімшартымен — иә: касса төлем туралы хабарлайды, тауар өзі кетеді. Kaspi-ге аударғанда бот чекті тексереді, ал ақшаның түскенін сіз бір батырмамен растайсыз: бот банкіңізге кірмейді.",
  "faq.rename.q": "{brand} және FrogFlow — бір нәрсе ме?",
  "faq.rename.a":
    "Иә. {brand} — FrogFlow платформасының жаңа атауы, FrogFlow Studio студиясының өнімі. Боттар, дүкендер, бағалар және панельге кіру бұрынғыдай қалады.",
  "final.title": "Мессенджерлердегі сатуды осы аптада іске қосыңыз",
  "final.text":
    "5 минутта кабинет ашып, тауарларды қосыңыз және сатып алушыларға бот сілтемесін жіберіңіз. Алғашқы {days} күн тегін.",
  "final.contacts": "Сұрақтарыңыз бар ма? Бізге жазыңыз, іске қосуға көмектесеміз.",
  "final.cta": "Дүкен ашу",
  "final.login": "Менің дүкенім бар",
  "footer.tagline": "Мессенджерлердегі сауда, төлем және ЖИ-кеңесші",
  "footer.formerly": "Бұрынғы атауы — FrogFlow",
  "footer.login": "Сатушыға кіру",
  "chat.avatar": "Ә",
};

const en: Dict = {
  "meta.title": "Sales bot for Instagram, Telegram and WhatsApp with Kaspi payments — {brand}",
  "meta.description":
    "{brand} answers customers, takes orders and Kaspi or card payments, and delivers the product by itself. Launch in an evening, no developer needed. {days} days free.",
  "nav.features": "Features",
  "nav.pay": "Payments",
  "nav.how": "Getting started",
  "nav.pricing": "Pricing",
  "nav.faq": "FAQ",
  "nav.login": "Log in",
  "nav.language": "Language",
  "nav.cta": "Try for free",
  "hero.eyebrow": "For sellers in Kazakhstan, Kyrgyzstan and Uzbekistan",
  "hero.titleHead": "Your shop in Instagram, Telegram and WhatsApp",
  "hero.titleTail": "sells by itself",
  "hero.lead":
    "The bot answers customers, shows the catalog, takes Kaspi or card payments and delivers the product. All you do is confirm the money with one button, and with a payment provider you don't even need that.",
  "hero.ctaSignup": "Try {days} days free",
  "hero.ctaLogin": "Log in to your shop",
  "hero.ctaDemo": "Message the demo bot",
  "hero.r1": "Nothing to pay to start",
  "hero.r2": "Launch in an evening, no developer",
  "hero.r3": "Bot speaks 4 languages: ru, kk, en, uz",
  "proof.title": "Already selling with {brand}",
  "proof.total": "orders delivered to customers through the platform",
  "proof.asOf": "Platform data as of {date}",
  "feat.title": "Everything for selling in messengers, in one place",
  "feat.sub":
    "Instead of separate tools for the bot, Direct replies, payments, a website and broadcasts: one panel and one subscription.",
  "feat.shop.title": "A shop in three messengers",
  "feat.shop.text":
    "Catalog, cart and checkout right inside Telegram, WhatsApp and Instagram. One catalog and one price list for every channel.",
  "feat.ai.title": "AI consultant in Direct",
  "feat.ai.text":
    "Answers from your price list and questionnaire day and night, moves commenters to Direct, and hands tricky cases to a manager with the request ready.",
  "feat.pay.title": "Kaspi and card payments",
  "feat.pay.text":
    "Kaspi details with receipt checks, Robokassa and Prodamus, deposits and cash on delivery.",
  "feat.deliver.title": "Delivery without you",
  "feat.deliver.text":
    "A file, access to a private channel or course lessons reach the customer as soon as payment is confirmed.",
  "feat.site.title": "Storefront by link",
  "feat.site.text":
    "A shop page for your profile bio: products, cart and checkout without a website or developer.",
  "feat.panel.title": "Seller panel on your phone",
  "feat.panel.text":
    "Orders, customers, broadcasts, promo codes and analytics. Excel export and team roles.",
  "feat.tiers": "What each plan includes is in the Pricing section.",
  "feat.niches": "Ready-made solutions:",
  "pay.title": "Kaspi or card payments, without the manual routine",
  "pay.sub":
    "Start with Kaspi transfers without signing anything: the bot checks the receipt. Once you have a payment provider contract, the provider confirms payments and the button is no longer needed.",
  "pay.checksTitle": "What the bot checks on a Kaspi receipt",
  "compare.title": "One service instead of five",
  "compare.sub":
    "A seller usually pays for several services and moves orders between them by hand.",
  "compare.usual": "Usually",
  "compare.r1": "A Telegram bot builder",
  "compare.r2": "Instagram Direct auto-replies",
  "compare.r3": "Payments and receipt checks",
  "compare.r4": "A landing page for your profile bio",
  "compare.r5": "Order spreadsheet, CRM and broadcasts",
  "compare.one": "With {brand}",
  "compare.oneTitle": "One panel for everything",
  "compare.oneText":
    "Customers, orders and payments from every channel in one place. One subscription from {price} a month.",
  "faq.title": "Frequently asked questions",
  "faq.countries.q": "Does it work in Kyrgyzstan and Uzbekistan?",
  "faq.countries.a":
    "Yes. Each country has its own prices, currency and payment details, and the bot speaks Russian, Kazakh, English and Uzbek. Where there is no Kaspi, the customer pays by card transfer and sends the receipt.",
  "faq.confirm.q": "Does the bot confirm payments by itself?",
  "faq.confirm.a":
    "With a Robokassa or Prodamus contract, yes: the provider reports the payment and the product goes out automatically. With Kaspi transfers the bot checks the receipt, and you confirm the money arrived with one button: the bot never logs into your bank.",
  "faq.rename.q": "Are {brand} and FrogFlow the same?",
  "faq.rename.a":
    "Yes. {brand} is the new name of the FrogFlow platform, a product of FrogFlow Studio. Bots, shops, prices and panel login stay the same.",
  "final.title": "Launch sales in messengers this week",
  "final.text":
    "Create your account in 5 minutes, add products and send customers the link to your bot. The first {days} days are free.",
  "final.contacts": "Questions? Message us and we'll help you launch.",
  "final.cta": "Open a shop",
  "final.login": "I already have a shop",
  "footer.tagline": "Sales, payments and an AI consultant in messengers",
  "footer.formerly": "Formerly FrogFlow",
  "footer.login": "Seller login",
  "chat.avatar": "A",
};

const uz: Dict = {
  "meta.title": "Instagram, Telegram va WhatsApp uchun savdo boti — {brand}",
  "meta.description":
    "{brand} xaridorlarga javob beradi, buyurtma va karta orqali to‘lov qabul qiladi hamda mahsulotni o‘zi beradi. Bir kechada ishga tushadi, dasturchisiz. {days} kun bepul.",
  "nav.features": "Imkoniyatlar",
  "nav.pay": "To‘lov",
  "nav.how": "Qanday boshlash",
  "nav.pricing": "Narxlar",
  "nav.faq": "Savollar",
  "nav.login": "Kirish",
  "nav.language": "Til",
  "nav.cta": "Bepul sinab ko‘rish",
  "hero.eyebrow": "Qozog‘iston, Qirg‘iziston va O‘zbekiston sotuvchilari uchun",
  "hero.titleHead": "Instagram, Telegram va WhatsApp’dagi do‘koningiz",
  "hero.titleTail": "o‘zi sotadi",
  "hero.lead":
    "Bot xaridorlarga javob beradi, katalogni ko‘rsatadi, Kaspi yoki karta orqali to‘lov qabul qiladi va mahsulotni beradi. Sizga pulni bitta tugma bilan tasdiqlash qoladi, kassa bilan esa bu ham kerak emas.",
  "hero.ctaSignup": "{days} kun bepul sinab ko‘rish",
  "hero.ctaLogin": "Do‘kon paneliga kirish",
  "hero.ctaDemo": "Demo-botga yozish",
  "hero.r1": "Boshlashda to‘lov yo‘q",
  "hero.r2": "Bir kechada ishga tushadi, dasturchisiz",
  "hero.r3": "Bot 4 tilda: ru, kk, en, uz",
  "proof.title": "{brand} bilan allaqachon sotmoqda",
  "proof.total": "buyurtma platforma orqali xaridorlarga berildi",
  "proof.asOf": "Platforma ma’lumotlari, {date} holatiga",
  "feat.title": "Messenjerlarda savdo uchun hammasi — bir joyda",
  "feat.sub":
    "Bot, Direct’dagi javoblar, to‘lov, sayt va xabarnomalar uchun alohida servislar o‘rniga — bitta panel va bitta obuna.",
  "feat.shop.title": "Uchta messenjerdagi do‘kon",
  "feat.shop.text":
    "Katalog, savat va buyurtma to‘g‘ridan-to‘g‘ri Telegram, WhatsApp va Instagram’da. Barcha kanallar uchun bitta katalog va bitta narx.",
  "feat.ai.title": "Direct’dagi AI-maslahatchi",
  "feat.ai.text":
    "Narxlaringiz va anketangiz bo‘yicha kechayu kunduz javob beradi, izohdan keyin xaridorga Direct’ga yozadi, murakkab savolni tayyor ariza bilan menejerga beradi.",
  "feat.pay.title": "Kaspi va karta orqali to‘lov",
  "feat.pay.text":
    "Kaspi rekvizitlari va chekni tekshirish, Robokassa va Prodamus, oldindan to‘lov va qabul qilganda to‘lash.",
  "feat.deliver.title": "Sizsiz yetkazish",
  "feat.deliver.text":
    "Fayl, yopiq kanalga kirish yoki kurs darslari to‘lov tasdiqlangan zahoti xaridorga keladi.",
  "feat.site.title": "Havola orqali vitrina",
  "feat.site.text":
    "Profil sarlavhasi uchun do‘kon sahifasi: mahsulotlar, savat va to‘lov sayt va dasturchisiz.",
  "feat.panel.title": "Telefondan sotuvchi paneli",
  "feat.panel.text":
    "Buyurtmalar, xaridorlar, xabarnomalar, promokodlar va analitika. Excel’ga yuklash va jamoa uchun rollar.",
  "feat.tiers": "Har bir tarifga nima kirishi — «Narxlar» bo‘limida.",
  "feat.niches": "Tayyor yechimlar:",
  "pay.title": "Kaspi yoki karta orqali to‘lov — qo‘l mehnatisiz",
  "pay.sub":
    "Hech narsaga imzo chekmasdan Kaspi o‘tkazmasidan boshlang: bot chekni o‘zi tekshiradi. Kassa bilan shartnoma paydo bo‘lsa, to‘lovni u tasdiqlaydi va tugma kerak bo‘lmaydi.",
  "pay.checksTitle": "Bot Kaspi chekida nimani tekshiradi",
  "compare.title": "Beshta servis o‘rniga bitta",
  "compare.sub":
    "Odatda sotuvchi bir nechta servisga pul to‘laydi va buyurtmalarni ular orasida qo‘lda ko‘chiradi.",
  "compare.usual": "Odatda",
  "compare.r1": "Telegram uchun bot konstruktori",
  "compare.r2": "Instagram Direct’da avtojavoblar",
  "compare.r3": "To‘lov qabul qilish va cheklarni tekshirish",
  "compare.r4": "Profil sarlavhasi uchun sayt-vizitka",
  "compare.r5": "Buyurtmalar jadvali, CRM va xabarnomalar",
  "compare.one": "{brand} bilan",
  "compare.oneTitle": "Hammasi uchun bitta panel",
  "compare.oneText":
    "Barcha kanallardan xaridorlar, buyurtmalar va to‘lovlar bir joyda. Oyiga {price} dan bitta obuna.",
  "faq.title": "Ko‘p beriladigan savollar",
  "faq.countries.q": "Qirg‘iziston va O‘zbekistonda ishlaydimi?",
  "faq.countries.a":
    "Ha. Har bir davlat uchun o‘z narxlari, valyutasi va rekvizitlari, bot rus, qozoq, ingliz va o‘zbek tillarida gaplashadi. Kaspi bo‘lmagan joyda xaridor kartaga o‘tkazma qilib, chek yuboradi.",
  "faq.confirm.q": "Bot to‘lovni o‘zi tasdiqlaydimi?",
  "faq.confirm.a":
    "Robokassa yoki Prodamus shartnomasi bilan — ha: kassa to‘lov haqida xabar beradi va mahsulot o‘zi ketadi. Kaspi o‘tkazmasida bot chekni tekshiradi, pul tushganini esa siz bitta tugma bilan tasdiqlaysiz: bot bankingizga kirmaydi.",
  "faq.rename.q": "{brand} va FrogFlow — bir narsami?",
  "faq.rename.a":
    "Ha. {brand} — FrogFlow platformasining yangi nomi, FrogFlow Studio mahsuloti. Botlar, do‘konlar, narxlar va panelga kirish avvalgidek qoladi.",
  "final.title": "Messenjerlarda savdoni shu haftada boshlang",
  "final.text":
    "5 daqiqada kabinet oching, mahsulotlarni qo‘shing va xaridorlarga bot havolasini yuboring. Birinchi {days} kun bepul.",
  "final.contacts": "Savollaringiz bormi? Bizga yozing, ishga tushirishga yordam beramiz.",
  "final.cta": "Do‘kon ochish",
  "final.login": "Menda do‘kon bor",
  "footer.tagline": "Messenjerlarda savdo, to‘lov va AI-maslahatchi",
  "footer.formerly": "Avvalgi nomi — FrogFlow",
  "footer.login": "Sotuvchi uchun kirish",
  "chat.avatar": "A",
};

const DICTS: Record<Locale, Dict> = { ru, kk, en, uz };

export type HomeT = (key: HomeKey, vars?: Record<string, string | number>) => string;

/** Переводчик главной: ключ → строка с подстановкой `{name}`; `{brand}` подставляется всегда. */
export function homeT(locale: Locale, brand: string): HomeT {
  const dict = DICTS[locale] ?? ru;
  return (key, vars) => {
    let s = dict[key] ?? ru[key] ?? key;
    for (const [k, v] of Object.entries({ brand, ...vars })) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
