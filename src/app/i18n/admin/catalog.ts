import type { ModuleKey } from "@/core/modules/registry";
import { moduleDef } from "@/core/modules/registry";
import type { VerticalKey } from "@/core/verticals/registry";
import type { SectionDict } from "../section";

/**
 * Каталог модулей и ниш для админки продавца. Русские тексты — копия
 * `core/modules/registry.ts` и `core/verticals/registry.ts` (панель оператора
 * читает реестр напрямую); `catalog.test.ts` следит, чтобы они совпадали и
 * новый модуль не появился без перевода.
 */
export const ru = {
  "moduleGroup.base": "База",
  "moduleGroup.payment": "Оплата",
  "moduleGroup.catalog": "Каталог",
  "moduleGroup.instagram": "Instagram",
  "moduleGroup.whatsapp": "WhatsApp",
  "moduleGroup.retention": "Удержание",
  "moduleGroup.service": "Сервис",
  "moduleGroup.analytics": "Аналитика",
  "moduleGroup.physical": "Физические товары",
  "module.shop.title": "Магазин",
  "module.shop.desc":
    "Каталог, корзина и оформление заказа в боте: покупатель выбирает, платит и получает заказ без вашего участия.",
  "module.broadcasts.title": "Рассылки по базе",
  "module.broadcasts.desc":
    "Сообщение с фото и кнопками всем покупателям или сегменту: купившим, не купившим, по стране.",
  "module.multi_files.title": "Материалы из нескольких файлов",
  "module.multi_files.desc":
    "К одному товару — несколько файлов и версии на разных языках; выдаются одним заказом.",
  "module.order_status.title": "«Где мой заказ»",
  "module.order_status.desc":
    "Кнопка «📋 Мои заказы» в боте: покупатель сам видит статус и состав заказа и не пишет вам «где мой заказ».",
  "module.excel_export.title": "Выгрузка в Excel",
  "module.excel_export.desc":
    "Заказы за период и база покупателей одной кнопкой — файл открывается в Excel и Google Таблицах.",
  "module.legal_docs.title": "Юридические страницы",
  "module.legal_docs.desc":
    "Оферта, политика конфиденциальности, реквизиты и «О продавце» — в боте и на витрине.",
  "module.dashboard.title": "Аналитика",
  "module.dashboard.desc":
    "Выручка, заказы и новые покупатели по дням, средний чек, топ товаров — с сравнением к прошлому периоду.",
  "module.robokassa.title": "Оплата картой (Robokassa)",
  "module.robokassa.desc":
    "Оплата картой прямо в боте: заказ подтверждается и выдаётся автоматически, без чеков.",
  "module.crypto.title": "Оплата криптой (NOWPayments)",
  "module.crypto.desc":
    "Оплата криптовалютой через счёт-инвойс; заказ выдаётся после подтверждения сети.",
  "module.courier.title": "Курьер и отслеживание (Яндекс Доставка, inDrive)",
  "module.courier.desc":
    "Заказ передаётся курьеру из карточки, покупатель сразу получает ссылку на отслеживание и телефон курьера.",
  "module.profit.title": "Себестоимость и прибыль",
  "module.profit.desc":
    "Себестоимость товаров и вариантов, а в аналитике — валовая прибыль и маржа за период.",
  "module.subscriptions.title": "Товары-подписки",
  "module.subscriptions.desc":
    "Товар по подписке раз в месяц или другой срок: бот сам напомнит продлить, продление — в два нажатия.",
  "module.public_api.title": "API для разработчиков",
  "module.public_api.desc":
    "Заказы и товары — в вашу учётную систему (1С, МойСклад, таблицы): чтение заказов, выгрузка каталога, обновление остатков и цен.",
  "module.kaspi_pay.title": "Оплата Kaspi Pay",
  "module.kaspi_pay.desc":
    "Оплата через Kaspi.kz по QR или ссылке; заказ подтверждается и выдаётся автоматически.",
  "module.stripe.title": "Оплата картой из-за рубежа (Stripe, PayPal)",
  "module.stripe.desc":
    "Покупатели из других стран платят иностранной картой или PayPal; заказ выдаётся после подтверждения платежа.",
  "module.receipt_ocr.title": "Распознавание чека",
  "module.receipt_ocr.desc":
    "Чек с переводом читается автоматически: сумма сошлась — файлы уходят сразу, вы не проверяете чеки руками. $2 за 1000 чеков.",
  "module.telegram_stars.title": "Оплата Telegram Stars",
  "module.telegram_stars.desc": "Оплата звёздами Telegram в один тап, без карт и реквизитов.",
  "module.coupons.title": "Скидки и промокоды",
  "module.coupons.desc":
    "Промокоды на процент или сумму с лимитом использований и сроком; покупатель вводит код в корзине.",
  "module.gift_certificates.title": "Подарочные сертификаты",
  "module.gift_certificates.desc":
    "Подарочные сертификаты на сумму: вы выдаёте код, получатель применяет его в корзине.",
  "module.upsell.title": "Апсейл и кросс-сейл",
  "module.upsell.desc":
    "«С этим часто берут» в корзине бота и Direct: ваши подборки к товару или популярное из той же категории.",
  "module.quiz.title": "Квиз-подбор",
  "module.quiz.desc": "Короткий опрос, который подбирает покупателю подходящий товар.",
  "module.multi_currency.title": "Мультивалютность",
  "module.multi_currency.desc":
    "Свои цены и реквизиты для каждой страны — покупатель видит суммы в своей валюте.",
  "module.multi_language.title": "Мультиязычность",
  "module.multi_language.desc":
    "Бот на русском, казахском, английском и узбекском; отдельные версии файлов для каждого языка.",
  "module.vip.title": "VIP-подписки",
  "module.vip.desc":
    "Платная подписка на закрытый канал или группу: доступ выдаётся и отзывается автоматически.",
  "module.blocked.title": "Блокировка пользователей",
  "module.blocked.desc":
    "Чёрный список: заблокированный покупатель не может писать боту и оформлять заказы.",
  "module.courses.title": "Курсы внутри магазина",
  "module.courses.desc":
    "Уроки по расписанию внутри бота: доступ открывается после оплаты, материалы выдаются по шагам.",
  "module.smart_search.title": "Умный поиск по каталогу",
  "module.smart_search.desc":
    "Когда обычный поиск не нашёл, запрос вроде «что-то на день рождения пятилетке» подбирается по смыслу.",
  "module.web_storefront.title": "Публичная веб-витрина",
  "module.web_storefront.desc":
    "Витрина по ссылке и с вашим доменом: каталог виден без Telegram, покупка — в боте одной кнопкой.",
  "module.telegram_mini_app.title": "Telegram Mini App",
  "module.telegram_mini_app.desc":
    "Магазин открывается внутри Telegram как приложение: каталог, корзина и оформление на одном экране.",
  "module.instagram.title": "Instagram-автоматизация",
  "module.instagram.desc": "Автоответы на комментарии и директ, сбор заявок из Instagram.",
  "module.dm_shop.title": "Магазин в директе",
  "module.dm_shop.desc": "Каталог и заказ прямо в переписке Instagram Direct.",
  "module.whatsapp.title": "WhatsApp-автоматизация",
  "module.whatsapp.desc":
    "Подключение номера WhatsApp Business, автоответчик и переписка из панели.",
  "module.wa_shop.title": "Магазин в WhatsApp",
  "module.wa_shop.desc": "Каталог, корзина и оформление заказа в чате WhatsApp.",
  "module.wa_broadcasts.title": "Рассылки в WhatsApp",
  "module.wa_broadcasts.desc": "Рассылки по базе WhatsApp одобренными шаблонами.",
  "module.cart_reminder.title": "Напоминание о брошенной корзине",
  "module.cart_reminder.desc":
    "Покупателю, который положил товар и не оформил заказ, бот напомнит об этом через заданное время: назовёт товары и сумму. Instagram и WhatsApp — пока открыто окно ответа 24 часа.",
  "module.winback.title": "Возвратные продажи",
  "module.winback.desc":
    "Серия из двух сообщений тем, кто давно не покупал: через N дней после последнего заказа и повтор, с промокодом. Сегменты базы — в рассылках.",
  "module.funnel.title": "Автоворонка",
  "module.funnel.desc": "Серия сообщений после подписки: прогрев, полезный контент, предложение.",
  "module.loyalty.title": "Программа лояльности",
  "module.loyalty.desc":
    "Баллы за покупки: процент от суммы после выдачи, списание в корзине при следующем заказе.",
  "module.referral.title": "Реферальная программа",
  "module.referral.desc":
    "Персональная ссылка «Пригласить друга»: промокод и приглашённому, и вам после его первой покупки.",
  "module.manager_chat.title": "Чат с менеджером",
  "module.manager_chat.desc":
    "Вся переписка бота с покупателями в панели; подключаетесь к диалогу и отвечаете сами, бот замолкает.",
  "module.helpdesk.title": "Мини-helpdesk",
  "module.helpdesk.desc": "Обращения покупателей как тикеты: статусы, ответственный, история.",
  "module.review_request.title": "Оценка после покупки",
  "module.review_request.desc":
    "После выдачи заказа покупатель ставит оценку и оставляет комментарий; рейтинг виден в карточке товара.",
  "module.notify_in_bot.title": "Дублирование уведомлений",
  "module.notify_in_bot.desc":
    "Уведомления о заказах приходят и в группу, и в личку всем указанным получателям; почта, тихие часы и утренний дайджест — в карточке «Уведомления».",
  "module.crm_pipeline.title": "Мини-CRM воронка",
  "module.crm_pipeline.desc": "Заявки и заказы на доске по стадиям сделки.",
  "module.admin_roles.title": "Мультиадминство с ролями",
  "module.admin_roles.desc":
    "Несколько сотрудников в панели с разными правами: владелец, менеджер, просмотр. Кто что сделал — в истории заказа.",
  "module.crm_integration.title": "Интеграция с CRM и Таблицами",
  "module.crm_integration.desc":
    "События заказов автоматически уходят в вашу CRM или Google Таблицы: создан, чек, выдан, отклонён.",
  "module.multi_bot.title": "Управление несколькими ботами",
  "module.multi_bot.desc": "Несколько ботов и магазинов под одним входом в панель.",
  "module.stock.title": "Складской учёт",
  "module.stock.desc":
    "Остатки по товарам: закончился — кнопка «В корзину» пропадает, при заказе остаток списывается.",
  "module.limited_offers.title": "Ограниченные предложения",
  "module.limited_offers.desc":
    "Акции с таймером и ограниченным количеством: скидка на товар до даты или на N штук, в карточке — отсчёт и остаток.",
  "module.waitlist.title": "Лист ожидания",
  "module.waitlist.desc":
    "Кнопка «Сообщить, когда появится»: бот сам напишет покупателю при поступлении.",
  "vertical.digital": "Цифровые материалы",
  "vertical.confectionery": "Кондитерская",
  "vertical.consultant": "Консультант (ун. BOVI)",
  "vertical.flowers": "Цветы и букеты",
  "vertical.courses": "Онлайн-школа",
  "vertical.consultant_universal": "Универсальный консультант",
} as const;

type CatalogKey = keyof typeof ru;

/** Раздел прайса (`ModuleDef.group`) → ключ словаря. */
export const MODULE_GROUP_SLUGS = {
  База: "base",
  Оплата: "payment",
  Каталог: "catalog",
  Instagram: "instagram",
  WhatsApp: "whatsapp",
  Удержание: "retention",
  Сервис: "service",
  Аналитика: "analytics",
  "Физические товары": "physical",
} as const;
type GroupSlug = (typeof MODULE_GROUP_SLUGS)[keyof typeof MODULE_GROUP_SLUGS];

export function moduleTitleKey<K extends ModuleKey>(k: K) {
  return `module.${k}.title` as const satisfies CatalogKey;
}

export function moduleDescKey<K extends ModuleKey>(k: K) {
  return `module.${k}.desc` as const satisfies CatalogKey;
}

export function moduleGroupKey(k: ModuleKey) {
  const slug: GroupSlug | undefined =
    MODULE_GROUP_SLUGS[moduleDef(k).group as keyof typeof MODULE_GROUP_SLUGS];
  if (!slug) throw new Error(`module group without translation: ${moduleDef(k).group}`);
  return `moduleGroup.${slug}` as const satisfies CatalogKey;
}

export function verticalTitleKey<V extends VerticalKey>(v: V) {
  return `vertical.${v}` as const satisfies CatalogKey;
}

export const kk: SectionDict<typeof ru> = {
  "moduleGroup.base": "Негізгі",
  "moduleGroup.payment": "Төлем",
  "moduleGroup.catalog": "Каталог",
  "moduleGroup.instagram": "Instagram",
  "moduleGroup.whatsapp": "WhatsApp",
  "moduleGroup.retention": "Сатып алушыны ұстап қалу",
  "moduleGroup.service": "Қызмет көрсету",
  "moduleGroup.analytics": "Аналитика",
  "moduleGroup.physical": "Физикалық тауарлар",
  "module.shop.title": "Дүкен",
  "module.shop.desc":
    "Боттағы каталог, себет және тапсырыс рәсімдеу: сатып алушы өзі таңдайды, төлейді және тапсырысын сіздің қатысуыңызсыз алады.",
  "module.broadcasts.title": "Базаға хабарлама тарату",
  "module.broadcasts.desc":
    "Фото мен түймелері бар хабарламаны барлық сатып алушыға немесе сегментке жіберу: сатып алғандарға, сатып алмағандарға, ел бойынша.",
  "module.multi_files.title": "Бірнеше файлдан тұратын материалдар",
  "module.multi_files.desc":
    "Бір тауарға — бірнеше файл және әртүрлі тілдердегі нұсқалар; барлығы бір тапсырыспен беріледі.",
  "module.order_status.title": "«Тапсырысым қайда»",
  "module.order_status.desc":
    "Боттағы «📋 Менің тапсырыстарым» түймесі: сатып алушы тапсырыстың күйі мен құрамын өзі көреді және сізге «тапсырысым қайда» деп жазбайды.",
  "module.excel_export.title": "Excel-ге жүктеу",
  "module.excel_export.desc":
    "Кезеңдегі тапсырыстар мен сатып алушылар базасы бір түймемен — файл Excel мен Google Кестелерде ашылады.",
  "module.legal_docs.title": "Заңдық беттер",
  "module.legal_docs.desc":
    "Оферта, құпиялылық саясаты, деректемелер және «Сатушы туралы» — ботта және витринада.",
  "module.dashboard.title": "Аналитика",
  "module.dashboard.desc":
    "Күн бойынша түсім, тапсырыстар және жаңа сатып алушылар, орташа чек, үздік тауарлар — өткен кезеңмен салыстырып.",
  "module.robokassa.title": "Картамен төлеу (Robokassa)",
  "module.robokassa.desc":
    "Тікелей ботта картамен төлеу: тапсырыс автоматты түрде расталып, беріледі, чексіз.",
  "module.crypto.title": "Криптовалютамен төлеу (NOWPayments)",
  "module.crypto.desc":
    "Шот-инвойс арқылы криптовалютамен төлеу; тапсырыс желі растағаннан кейін беріледі.",
  "module.courier.title": "Курьер және бақылау (Яндекс Жеткізу, inDrive)",
  "module.courier.desc":
    "Тапсырыс карточкадан курьерге беріледі, сатып алушы бақылау сілтемесі мен курьер телефонын бірден алады.",
  "module.profit.title": "Өзіндік құн және пайда",
  "module.profit.desc":
    "Тауарлар мен нұсқалардың өзіндік құны, ал аналитикада — кезеңдегі жалпы пайда мен маржа.",
  "module.subscriptions.title": "Жазылым тауарлары",
  "module.subscriptions.desc":
    "Айына бір рет немесе басқа мерзіммен жазылым тауары: бот ұзартуды өзі еске салады, ұзарту — екі басумен.",
  "module.public_api.title": "Әзірлеушілерге арналған API",
  "module.public_api.desc":
    "Тапсырыстар мен тауарлар — сіздің есеп жүйеңізге (1С, МойСклад, кестелер): тапсырыстарды оқу, каталогты түсіру, қалдықтар мен бағаларды жаңарту.",
  "module.kaspi_pay.title": "Kaspi Pay арқылы төлеу",
  "module.kaspi_pay.desc":
    "Kaspi.kz арқылы QR немесе сілтеме бойынша төлем; тапсырыс автоматты түрде расталып, беріледі.",
  "module.stripe.title": "Шетелден картамен төлеу (Stripe, PayPal)",
  "module.stripe.desc":
    "Басқа елдердің сатып алушылары шетелдік картамен немесе PayPal арқылы төлейді; тапсырыс төлем расталғаннан кейін беріледі.",
  "module.receipt_ocr.title": "Чекті тану",
  "module.receipt_ocr.desc":
    "Аударым чегі автоматты түрде оқылады: сомасы сәйкес келсе, файлдар бірден жіберіледі, чектерді қолмен тексермейсіз. 1000 чек үшін $2.",
  "module.telegram_stars.title": "Telegram Stars арқылы төлеу",
  "module.telegram_stars.desc":
    "Telegram жұлдыздарымен бір түрту арқылы төлеу, картасыз және деректемесіз.",
  "module.coupons.title": "Жеңілдіктер мен промокодтар",
  "module.coupons.desc":
    "Пайыздық немесе сомалық промокодтар, пайдалану лимиті мен мерзімі бар; сатып алушы кодты себетте енгізеді.",
  "module.gift_certificates.title": "Сыйлық сертификаттары",
  "module.gift_certificates.desc":
    "Белгілі бір сомаға сыйлық сертификаттары: сіз код бересіз, алушы оны себетте қолданады.",
  "module.upsell.title": "Апсейл және кросс-сейл",
  "module.upsell.desc":
    "Бот себетінде және Direct-те «Мұнымен жиі алады»: тауарға өзіңіз таңдаған ұсыныстар немесе сол санаттағы танымал тауарлар.",
  "module.quiz.title": "Квиз-таңдау",
  "module.quiz.desc": "Сатып алушыға лайықты тауарды таңдап беретін қысқа сауалнама.",
  "module.multi_currency.title": "Көпвалюталық",
  "module.multi_currency.desc":
    "Әр елге өз бағалары мен деректемелері — сатып алушы сомаларды өз валютасында көреді.",
  "module.multi_language.title": "Көптілділік",
  "module.multi_language.desc":
    "Бот орыс, қазақ, ағылшын және өзбек тілдерінде; әр тілге файлдардың жеке нұсқалары.",
  "module.vip.title": "VIP-жазылымдар",
  "module.vip.desc":
    "Жабық арнаға немесе топқа ақылы жазылым: қолжетімділік автоматты түрде беріліп, қайтарылады.",
  "module.blocked.title": "Пайдаланушыларды бұғаттау",
  "module.blocked.desc":
    "Қара тізім: бұғатталған сатып алушы ботқа жаза алмайды және тапсырыс рәсімдей алмайды.",
  "module.courses.title": "Дүкен ішіндегі курстар",
  "module.courses.desc":
    "Бот ішінде кесте бойынша сабақтар: қолжетімділік төлемнен кейін ашылады, материалдар қадам-қадаммен беріледі.",
  "module.smart_search.title": "Каталог бойынша ақылды іздеу",
  "module.smart_search.desc":
    "Кәдімгі іздеу таппаса, «бес жасар балаға туған күнге бірдеңе» сияқты сұрау мағынасы бойынша таңдалады.",
  "module.web_storefront.title": "Ашық веб-витрина",
  "module.web_storefront.desc":
    "Сілтеме арқылы және өз доменіңіздегі витрина: каталог Telegram-сыз көрінеді, сатып алу — ботта бір түймемен.",
  "module.telegram_mini_app.title": "Telegram Mini App",
  "module.telegram_mini_app.desc":
    "Дүкен Telegram ішінде қолданба ретінде ашылады: каталог, себет және рәсімдеу бір экранда.",
  "module.instagram.title": "Instagram-автоматтандыру",
  "module.instagram.desc": "Пікірлер мен директке автожауаптар, Instagram-нан өтінімдер жинау.",
  "module.dm_shop.title": "Директтегі дүкен",
  "module.dm_shop.desc": "Каталог пен тапсырыс тікелей Instagram Direct хат алмасуында.",
  "module.whatsapp.title": "WhatsApp-автоматтандыру",
  "module.whatsapp.desc":
    "WhatsApp Business нөмірін қосу, автожауап беруші және панельден хат алмасу.",
  "module.wa_shop.title": "WhatsApp-тағы дүкен",
  "module.wa_shop.desc": "WhatsApp чатындағы каталог, себет және тапсырыс рәсімдеу.",
  "module.wa_broadcasts.title": "WhatsApp-та хабарлама тарату",
  "module.wa_broadcasts.desc": "Мақұлданған үлгілермен WhatsApp базасына хабарлама тарату.",
  "module.cart_reminder.title": "Тасталған себет туралы еске салу",
  "module.cart_reminder.desc":
    "Тауарды себетке салып, тапсырысты рәсімдемеген сатып алушыға бот белгіленген уақыттан кейін бұл туралы еске салады: тауарлар мен соманы атайды. Instagram және WhatsApp — 24 сағаттық жауап терезесі ашық кезде.",
  "module.winback.title": "Қайтару сатылымдары",
  "module.winback.desc":
    "Көптен бері сатып алмағандарға екі хабарламалық серия: соңғы тапсырыстан N күн өткен соң және қайталау, промокодпен. База сегменттері — хабарлама таратуда.",
  "module.funnel.title": "Автоворонка",
  "module.funnel.desc":
    "Жазылғаннан кейінгі хабарламалар сериясы: қызықтыру, пайдалы контент, ұсыныс.",
  "module.loyalty.title": "Адалдық бағдарламасы",
  "module.loyalty.desc":
    "Сатып алу үшін ұпайлар: тапсырыс берілгеннен кейін сомадан пайыз, келесі тапсырыста себетте жұмсалады.",
  "module.referral.title": "Рефералдық бағдарлама",
  "module.referral.desc":
    "«Досыңды шақыр» жеке сілтемесі: промокод шақырылған адамға да, оның бірінші сатып алуынан кейін сізге де.",
  "module.manager_chat.title": "Менеджермен чат",
  "module.manager_chat.desc":
    "Боттың сатып алушылармен барлық хат алмасуы панельде; диалогқа қосылып, өзіңіз жауап бересіз, бот үндемейді.",
  "module.helpdesk.title": "Мини-helpdesk",
  "module.helpdesk.desc":
    "Сатып алушылардың өтініштері тикет ретінде: күйлер, жауапты адам, тарих.",
  "module.review_request.title": "Сатып алудан кейінгі баға",
  "module.review_request.desc":
    "Тапсырыс берілгеннен кейін сатып алушы баға қойып, пікір қалдырады; рейтинг тауар карточкасында көрінеді.",
  "module.notify_in_bot.title": "Хабарламаларды қайталау",
  "module.notify_in_bot.desc":
    "Тапсырыс туралы хабарламалар топқа да, көрсетілген барлық алушыларға жеке де келеді; пошта, тыныш сағаттар және таңғы дайджест — «Хабарламалар» карточкасында.",
  "module.crm_pipeline.title": "Мини-CRM воронкасы",
  "module.crm_pipeline.desc": "Өтінімдер мен тапсырыстар мәміле кезеңдері бойынша тақтада.",
  "module.admin_roles.title": "Рөлдері бар бірнеше әкімші",
  "module.admin_roles.desc":
    "Панельде әртүрлі құқықтары бар бірнеше қызметкер: иесі, менеджер, тек қарау. Кім не істегені — тапсырыс тарихында.",
  "module.crm_integration.title": "CRM және Кестелермен интеграция",
  "module.crm_integration.desc":
    "Тапсырыс оқиғалары автоматты түрде сіздің CRM-ге немесе Google Кестелерге жіберіледі: жасалды, чек, берілді, қабылданбады.",
  "module.multi_bot.title": "Бірнеше ботты басқару",
  "module.multi_bot.desc": "Панельге бір кіру арқылы бірнеше бот пен дүкен.",
  "module.stock.title": "Қойма есебі",
  "module.stock.desc":
    "Тауарлар бойынша қалдықтар: тауар бітсе — «Себетке» түймесі жоғалады, тапсырыс кезінде қалдық шегеріледі.",
  "module.limited_offers.title": "Шектеулі ұсыныстар",
  "module.limited_offers.desc":
    "Таймері және шектеулі саны бар акциялар: белгілі күнге дейін немесе N данаға тауар жеңілдігі, карточкада — кері санақ пен қалдық.",
  "module.waitlist.title": "Күту парағы",
  "module.waitlist.desc":
    "«Пайда болғанда хабарлау» түймесі: тауар түскенде бот сатып алушыға өзі жазады.",
  "vertical.digital": "Цифрлық материалдар",
  "vertical.confectionery": "Кондитерлік",
  "vertical.consultant": "Кеңесші (BOVI)",
  "vertical.flowers": "Гүлдер мен букеттер",
  "vertical.courses": "Онлайн-мектеп",
  "vertical.consultant_universal": "Әмбебап кеңесші",
};

export const en: SectionDict<typeof ru> = {
  "moduleGroup.base": "Basics",
  "moduleGroup.payment": "Payments",
  "moduleGroup.catalog": "Catalog",
  "moduleGroup.instagram": "Instagram",
  "moduleGroup.whatsapp": "WhatsApp",
  "moduleGroup.retention": "Retention",
  "moduleGroup.service": "Customer service",
  "moduleGroup.analytics": "Analytics",
  "moduleGroup.physical": "Physical goods",
  "module.shop.title": "Shop",
  "module.shop.desc":
    "Catalog, cart and checkout in the bot: customers choose, pay and receive their order without you lifting a finger.",
  "module.broadcasts.title": "Broadcasts",
  "module.broadcasts.desc":
    "A message with a photo and buttons to all customers or a segment: buyers, non-buyers, by country.",
  "module.multi_files.title": "Multi-file materials",
  "module.multi_files.desc":
    "Several files per product, plus versions in different languages, delivered in a single order.",
  "module.order_status.title": "“Where’s my order”",
  "module.order_status.desc":
    "A “📋 My orders” button in the bot: customers check the status and contents of their order themselves instead of asking you.",
  "module.excel_export.title": "Excel export",
  "module.excel_export.desc":
    "Orders for any period and your customer list in one click — the file opens in Excel and Google Sheets.",
  "module.legal_docs.title": "Legal pages",
  "module.legal_docs.desc":
    "Public offer, privacy policy, business details and “About the seller” — in the bot and on the storefront.",
  "module.dashboard.title": "Analytics",
  "module.dashboard.desc":
    "Revenue, orders and new customers by day, average order value, top products — compared with the previous period.",
  "module.robokassa.title": "Card payments (Robokassa)",
  "module.robokassa.desc":
    "Card payments right in the bot: orders are confirmed and delivered automatically, no receipts needed.",
  "module.crypto.title": "Crypto payments (NOWPayments)",
  "module.crypto.desc":
    "Cryptocurrency payments via an invoice; the order is delivered once the network confirms the payment.",
  "module.courier.title": "Courier and tracking (Yandex Delivery, inDrive)",
  "module.courier.desc":
    "Hand the order to a courier from its card; the customer instantly gets a tracking link and the courier’s phone.",
  "module.profit.title": "Cost and profit",
  "module.profit.desc":
    "Cost of products and variants and, in analytics, gross profit and margin for the period.",
  "module.subscriptions.title": "Subscription products",
  "module.subscriptions.desc":
    "A product bought monthly or on another cycle: the bot reminds the customer to renew, renewal takes two taps.",
  "module.public_api.title": "Developer API",
  "module.public_api.desc":
    "Orders and products in your accounting system (1C, MoySklad, spreadsheets): read orders, export the catalog, update stock and prices.",
  "module.kaspi_pay.title": "Kaspi Pay payments",
  "module.kaspi_pay.desc":
    "Payment via Kaspi.kz by QR or link; the order is confirmed and delivered automatically.",
  "module.stripe.title": "Card payments from abroad (Stripe, PayPal)",
  "module.stripe.desc":
    "Customers from other countries pay with a foreign card or PayPal; the order is delivered once the payment is confirmed.",
  "module.receipt_ocr.title": "Receipt recognition",
  "module.receipt_ocr.desc":
    "Transfer receipts are read automatically: if the amount matches, the files go out right away — no more checking receipts by hand. $2 per 1,000 receipts.",
  "module.telegram_stars.title": "Telegram Stars payments",
  "module.telegram_stars.desc": "One-tap payment with Telegram Stars — no cards or bank details.",
  "module.coupons.title": "Discounts and promo codes",
  "module.coupons.desc":
    "Percentage or fixed-amount promo codes with a usage limit and expiry date; customers enter the code in the cart.",
  "module.gift_certificates.title": "Gift cards",
  "module.gift_certificates.desc":
    "Gift cards for a set amount: you issue a code, and the recipient redeems it in the cart.",
  "module.upsell.title": "Upsell and cross-sell",
  "module.upsell.desc":
    "“Frequently bought together” in the bot cart and in Direct: your own picks for a product or bestsellers from the same category.",
  "module.quiz.title": "Product finder quiz",
  "module.quiz.desc": "A short quiz that finds the right product for the customer.",
  "module.multi_currency.title": "Multi-currency",
  "module.multi_currency.desc":
    "Separate prices and payment details for each country — customers see amounts in their own currency.",
  "module.multi_language.title": "Multi-language",
  "module.multi_language.desc":
    "The bot in Russian, Kazakh, English and Uzbek, with separate file versions for each language.",
  "module.vip.title": "VIP subscriptions",
  "module.vip.desc":
    "Paid subscription to a private channel or group: access is granted and revoked automatically.",
  "module.blocked.title": "Blocking users",
  "module.blocked.desc": "A blacklist: a blocked customer can’t message the bot or place orders.",
  "module.courses.title": "Courses in your shop",
  "module.courses.desc":
    "Scheduled lessons inside the bot: access opens after payment and materials are released step by step.",
  "module.smart_search.title": "Smart catalog search",
  "module.smart_search.desc":
    "When regular search finds nothing, a request like “something for a five-year-old’s birthday” is matched by meaning.",
  "module.web_storefront.title": "Public web storefront",
  "module.web_storefront.desc":
    "A storefront at a link or on your own domain: the catalog is visible without Telegram, and purchase takes one tap in the bot.",
  "module.telegram_mini_app.title": "Telegram Mini App",
  "module.telegram_mini_app.desc":
    "Your shop opens inside Telegram as an app: catalog, cart and checkout on one screen.",
  "module.instagram.title": "Instagram automation",
  "module.instagram.desc": "Auto-replies to comments and DMs, lead collection from Instagram.",
  "module.dm_shop.title": "Shop in Direct",
  "module.dm_shop.desc": "Catalog and ordering right inside Instagram Direct chats.",
  "module.whatsapp.title": "WhatsApp automation",
  "module.whatsapp.desc":
    "Connect a WhatsApp Business number, set up auto-replies and chat from the panel.",
  "module.wa_shop.title": "Shop in WhatsApp",
  "module.wa_shop.desc": "Catalog, cart and checkout in a WhatsApp chat.",
  "module.wa_broadcasts.title": "WhatsApp broadcasts",
  "module.wa_broadcasts.desc": "Broadcasts to your WhatsApp contacts using approved templates.",
  "module.cart_reminder.title": "Abandoned cart reminder",
  "module.cart_reminder.desc":
    "If a customer adds a product but doesn’t check out, the bot reminds them after a set time, naming the items and the total. Instagram and WhatsApp — while the 24-hour reply window is open.",
  "module.winback.title": "Win-back sales",
  "module.winback.desc":
    "A two-message series for customers who haven’t bought in a while: N days after their last order and a follow-up, with a promo code. Customer segments are in Broadcasts.",
  "module.funnel.title": "Auto funnel",
  "module.funnel.desc": "A message series after subscribing: warm-up, useful content, an offer.",
  "module.loyalty.title": "Loyalty program",
  "module.loyalty.desc":
    "Points for purchases: a percentage of the amount after delivery, redeemable in the cart on the next order.",
  "module.referral.title": "Referral program",
  "module.referral.desc":
    "A personal “Invite a friend” link: a promo code for the invited friend, and one for you after their first purchase.",
  "module.manager_chat.title": "Chat with a manager",
  "module.manager_chat.desc":
    "All bot conversations with customers in the panel; join a chat and reply yourself — the bot goes quiet.",
  "module.helpdesk.title": "Mini helpdesk",
  "module.helpdesk.desc": "Customer requests as tickets: statuses, assignee, history.",
  "module.review_request.title": "Post-purchase rating",
  "module.review_request.desc":
    "After the order is delivered, the customer leaves a rating and a comment; the rating is shown on the product card.",
  "module.notify_in_bot.title": "Duplicate notifications",
  "module.notify_in_bot.desc":
    "Order notifications go both to the group and privately to every listed recipient; email, quiet hours and the morning digest are in the “Notifications” card.",
  "module.crm_pipeline.title": "Mini CRM pipeline",
  "module.crm_pipeline.desc": "Leads and orders on a board by deal stage.",
  "module.admin_roles.title": "Multiple admins with roles",
  "module.admin_roles.desc":
    "Several team members in the panel with different permissions: owner, manager, view-only. Who did what is in the order history.",
  "module.crm_integration.title": "CRM and Sheets integration",
  "module.crm_integration.desc":
    "Order events are sent automatically to your CRM or Google Sheets: created, receipt, delivered, rejected.",
  "module.multi_bot.title": "Managing multiple bots",
  "module.multi_bot.desc": "Several bots and shops under one panel login.",
  "module.stock.title": "Inventory",
  "module.stock.desc":
    "Stock levels per product: when it runs out, the “Add to cart” button disappears; stock is deducted on order.",
  "module.limited_offers.title": "Limited offers",
  "module.limited_offers.desc":
    "Promotions with a timer and limited quantity: a discount until a date or for N items, with a countdown and remaining stock on the product card.",
  "module.waitlist.title": "Waitlist",
  "module.waitlist.desc":
    "A “Notify me when available” button: the bot messages the customer as soon as it’s back in stock.",
  "vertical.digital": "Digital products",
  "vertical.confectionery": "Confectionery",
  "vertical.consultant": "Consultant (BOVI)",
  "vertical.flowers": "Flowers and bouquets",
  "vertical.courses": "Online school",
  "vertical.consultant_universal": "Universal consultant",
};

export const uz: SectionDict<typeof ru> = {
  "moduleGroup.base": "Asosiy",
  "moduleGroup.payment": "Toʻlov",
  "moduleGroup.catalog": "Katalog",
  "moduleGroup.instagram": "Instagram",
  "moduleGroup.whatsapp": "WhatsApp",
  "moduleGroup.retention": "Mijozlarni ushlab qolish",
  "moduleGroup.service": "Xizmat koʻrsatish",
  "moduleGroup.analytics": "Analitika",
  "moduleGroup.physical": "Jismoniy mahsulotlar",
  "module.shop.title": "Doʻkon",
  "module.shop.desc":
    "Botda katalog, savat va buyurtma rasmiylashtirish: xaridor oʻzi tanlaydi, toʻlaydi va buyurtmani sizning ishtirokingizsiz oladi.",
  "module.broadcasts.title": "Baza boʻyicha xabar yuborish",
  "module.broadcasts.desc":
    "Rasm va tugmali xabarni barcha xaridorlarga yoki segmentga yuborish: xarid qilganlarga, qilmaganlarga, mamlakat boʻyicha.",
  "module.multi_files.title": "Bir nechta fayldan iborat materiallar",
  "module.multi_files.desc":
    "Bitta mahsulotga — bir nechta fayl va turli tillardagi versiyalar; hammasi bitta buyurtmada beriladi.",
  "module.order_status.title": "«Buyurtmam qayerda»",
  "module.order_status.desc":
    "Botdagi «📋 Buyurtmalarim» tugmasi: xaridor buyurtma holati va tarkibini oʻzi koʻradi va sizga «buyurtmam qayerda» deb yozmaydi.",
  "module.excel_export.title": "Excelga yuklab olish",
  "module.excel_export.desc":
    "Davr boʻyicha buyurtmalar va xaridorlar bazasi bitta tugma bilan — fayl Excel va Google Jadvallarda ochiladi.",
  "module.legal_docs.title": "Yuridik sahifalar",
  "module.legal_docs.desc":
    "Oferta, maxfiylik siyosati, rekvizitlar va «Sotuvchi haqida» — botda va vitrinada.",
  "module.dashboard.title": "Analitika",
  "module.dashboard.desc":
    "Kunlar boʻyicha tushum, buyurtmalar va yangi xaridorlar, oʻrtacha chek, top mahsulotlar — oʻtgan davr bilan solishtirib.",
  "module.robokassa.title": "Karta orqali toʻlov (Robokassa)",
  "module.robokassa.desc":
    "Toʻgʻridan-toʻgʻri botda karta orqali toʻlov: buyurtma avtomatik tasdiqlanadi va beriladi, cheksiz.",
  "module.crypto.title": "Kripto orqali toʻlov (NOWPayments)",
  "module.crypto.desc":
    "Hisob-invoys orqali kriptovalyutada toʻlov; buyurtma tarmoq tasdiqlagandan keyin beriladi.",
  "module.courier.title": "Kuryer va kuzatish (Yandex Yetkazish, inDrive)",
  "module.courier.desc":
    "Buyurtma kartadan kuryerga topshiriladi, xaridor darhol kuzatish havolasi va kuryer telefonini oladi.",
  "module.profit.title": "Tannarx va foyda",
  "module.profit.desc":
    "Mahsulot va variantlar tannarxi, tahlilda esa davr uchun yalpi foyda va marja.",
  "module.subscriptions.title": "Obuna tovarlari",
  "module.subscriptions.desc":
    "Oyiga bir marta yoki boshqa muddatda obuna tovari: bot uzaytirishni oʻzi eslatadi, uzaytirish — ikki bosishda.",
  "module.public_api.title": "Dasturchilar uchun API",
  "module.public_api.desc":
    "Buyurtmalar va tovarlar — hisob tizimingizga (1C, MoySklad, jadvallar): buyurtmalarni oʻqish, katalogni yuklab olish, qoldiq va narxlarni yangilash.",
  "module.kaspi_pay.title": "Kaspi Pay orqali toʻlov",
  "module.kaspi_pay.desc":
    "Kaspi.kz orqali QR yoki havola boʻyicha toʻlov; buyurtma avtomatik tasdiqlanadi va beriladi.",
  "module.stripe.title": "Chet eldan karta orqali toʻlov (Stripe, PayPal)",
  "module.stripe.desc":
    "Boshqa mamlakatlardagi xaridorlar xorijiy karta yoki PayPal orqali toʻlaydi; buyurtma toʻlov tasdiqlangach beriladi.",
  "module.receipt_ocr.title": "Chekni aniqlash",
  "module.receipt_ocr.desc":
    "Oʻtkazma cheki avtomatik oʻqiladi: summa mos kelsa, fayllar darhol yuboriladi, cheklarni qoʻlda tekshirmaysiz. 1000 ta chek uchun $2.",
  "module.telegram_stars.title": "Telegram Stars orqali toʻlov",
  "module.telegram_stars.desc":
    "Telegram yulduzlari bilan bir bosishda toʻlov, kartasiz va rekvizitlarsiz.",
  "module.coupons.title": "Chegirmalar va promokodlar",
  "module.coupons.desc":
    "Foiz yoki summa boʻyicha promokodlar, foydalanish limiti va muddati bilan; xaridor kodni savatda kiritadi.",
  "module.gift_certificates.title": "Sovgʻa sertifikatlari",
  "module.gift_certificates.desc":
    "Maʼlum summaga sovgʻa sertifikatlari: siz kod berasiz, oluvchi uni savatda qoʻllaydi.",
  "module.upsell.title": "Apsell va kross-sell",
  "module.upsell.desc":
    "Bot savatida va Directda «Bu bilan koʻpincha olishadi»: mahsulotga oʻzingiz tanlagan takliflar yoki shu kategoriyadagi mashhur mahsulotlar.",
  "module.quiz.title": "Kviz-tanlov",
  "module.quiz.desc": "Xaridorga mos mahsulotni tanlab beradigan qisqa soʻrovnoma.",
  "module.multi_currency.title": "Koʻp valyutalilik",
  "module.multi_currency.desc":
    "Har bir mamlakat uchun oʻz narxlari va rekvizitlari — xaridor summalarni oʻz valyutasida koʻradi.",
  "module.multi_language.title": "Koʻp tillilik",
  "module.multi_language.desc":
    "Bot rus, qozoq, ingliz va oʻzbek tillarida; har bir til uchun fayllarning alohida versiyalari.",
  "module.vip.title": "VIP obunalar",
  "module.vip.desc":
    "Yopiq kanal yoki guruhga pullik obuna: kirish huquqi avtomatik beriladi va bekor qilinadi.",
  "module.blocked.title": "Foydalanuvchilarni bloklash",
  "module.blocked.desc":
    "Qora roʻyxat: bloklangan xaridor botga yoza olmaydi va buyurtma bera olmaydi.",
  "module.courses.title": "Doʻkon ichidagi kurslar",
  "module.courses.desc":
    "Bot ichida jadval boʻyicha darslar: kirish toʻlovdan keyin ochiladi, materiallar bosqichma-bosqich beriladi.",
  "module.smart_search.title": "Katalog boʻyicha aqlli qidiruv",
  "module.smart_search.desc":
    "Oddiy qidiruv topmasa, «besh yoshli bolaning tugʻilgan kuniga biror narsa» kabi soʻrov maʼnosi boʻyicha tanlanadi.",
  "module.web_storefront.title": "Ochiq veb-vitrina",
  "module.web_storefront.desc":
    "Havola orqali va oʻz domeningizdagi vitrina: katalog Telegramsiz koʻrinadi, xarid — botda bitta tugma bilan.",
  "module.telegram_mini_app.title": "Telegram Mini App",
  "module.telegram_mini_app.desc":
    "Doʻkon Telegram ichida ilova sifatida ochiladi: katalog, savat va rasmiylashtirish bitta ekranda.",
  "module.instagram.title": "Instagram avtomatlashtirish",
  "module.instagram.desc": "Izohlar va directga avtojavoblar, Instagramdan arizalar yigʻish.",
  "module.dm_shop.title": "Directdagi doʻkon",
  "module.dm_shop.desc": "Katalog va buyurtma toʻgʻridan-toʻgʻri Instagram Direct yozishmasida.",
  "module.whatsapp.title": "WhatsApp avtomatlashtirish",
  "module.whatsapp.desc": "WhatsApp Business raqamini ulash, avtojavob va paneldan yozishma.",
  "module.wa_shop.title": "WhatsAppdagi doʻkon",
  "module.wa_shop.desc": "WhatsApp chatida katalog, savat va buyurtma rasmiylashtirish.",
  "module.wa_broadcasts.title": "WhatsAppda xabar yuborish",
  "module.wa_broadcasts.desc": "Tasdiqlangan shablonlar bilan WhatsApp bazasiga xabar yuborish.",
  "module.cart_reminder.title": "Tashlab ketilgan savat haqida eslatma",
  "module.cart_reminder.desc":
    "Mahsulotni savatga solib, buyurtma bermagan xaridorga bot belgilangan vaqtdan keyin bu haqda eslatadi: mahsulotlar va summani aytadi. Instagram va WhatsApp — 24 soatlik javob oynasi ochiq bo‘lganda.",
  "module.winback.title": "Qaytaruvchi sotuvlar",
  "module.winback.desc":
    "Uzoq vaqt xarid qilmaganlarga ikki xabardan iborat seriya: oxirgi buyurtmadan N kun oʻtgach va takroriy, promokod bilan. Baza segmentlari — xabar yuborishda.",
  "module.funnel.title": "Avtovoronka",
  "module.funnel.desc": "Obunadan keyingi xabarlar seriyasi: qiziqtirish, foydali kontent, taklif.",
  "module.loyalty.title": "Sodiqlik dasturi",
  "module.loyalty.desc":
    "Xaridlar uchun ballar: buyurtma berilgandan keyin summadan foiz, keyingi buyurtmada savatda sarflanadi.",
  "module.referral.title": "Referal dastur",
  "module.referral.desc":
    "«Doʻstni taklif qilish» shaxsiy havolasi: promokod taklif qilinganga ham, uning birinchi xarididan keyin sizga ham.",
  "module.manager_chat.title": "Menejer bilan chat",
  "module.manager_chat.desc":
    "Botning xaridorlar bilan barcha yozishmalari panelda; dialogga qoʻshilib, oʻzingiz javob berasiz, bot jim turadi.",
  "module.helpdesk.title": "Mini-helpdesk",
  "module.helpdesk.desc": "Xaridorlar murojaatlari tiket sifatida: holatlar, masʼul shaxs, tarix.",
  "module.review_request.title": "Xariddan keyingi baho",
  "module.review_request.desc":
    "Buyurtma berilgandan keyin xaridor baho qoʻyadi va izoh qoldiradi; reyting mahsulot kartochkasida koʻrinadi.",
  "module.notify_in_bot.title": "Xabarnomalarni takrorlash",
  "module.notify_in_bot.desc":
    "Buyurtmalar haqidagi xabarnomalar guruhga ham, koʻrsatilgan barcha oluvchilarga shaxsiy ham keladi; pochta, tinch soatlar va ertalabki dayjest — «Xabarnomalar» kartochkasida.",
  "module.crm_pipeline.title": "Mini-CRM voronkasi",
  "module.crm_pipeline.desc": "Arizalar va buyurtmalar bitim bosqichlari boʻyicha doskada.",
  "module.admin_roles.title": "Rollar bilan bir nechta admin",
  "module.admin_roles.desc":
    "Panelda turli huquqlarga ega bir nechta xodim: egasi, menejer, faqat koʻrish. Kim nima qilgani — buyurtma tarixida.",
  "module.crm_integration.title": "CRM va Jadvallar bilan integratsiya",
  "module.crm_integration.desc":
    "Buyurtma hodisalari avtomatik ravishda CRM yoki Google Jadvallarga yuboriladi: yaratildi, chek, berildi, rad etildi.",
  "module.multi_bot.title": "Bir nechta botni boshqarish",
  "module.multi_bot.desc": "Panelga bitta kirish orqali bir nechta bot va doʻkon.",
  "module.stock.title": "Ombor hisobi",
  "module.stock.desc":
    "Mahsulotlar boʻyicha qoldiqlar: tugasa — «Savatga» tugmasi yoʻqoladi, buyurtmada qoldiq kamaytiriladi.",
  "module.limited_offers.title": "Cheklangan takliflar",
  "module.limited_offers.desc":
    "Taymer va cheklangan miqdordagi aksiyalar: sanagacha yoki N dona uchun mahsulotga chegirma, kartochkada — teskari sanoq va qoldiq.",
  "module.waitlist.title": "Kutish roʻyxati",
  "module.waitlist.desc":
    "«Paydo boʻlganda xabar berish» tugmasi: mahsulot kelganda bot xaridorga oʻzi yozadi.",
  "vertical.digital": "Raqamli materiallar",
  "vertical.confectionery": "Qandolatchilik",
  "vertical.consultant": "Maslahatchi (BOVI)",
  "vertical.flowers": "Gullar va guldastalar",
  "vertical.courses": "Onlayn maktab",
  "vertical.consultant_universal": "Universal maslahatchi",
};
