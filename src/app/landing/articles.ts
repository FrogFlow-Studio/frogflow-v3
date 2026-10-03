/**
 * SEO-статьи платформы: /blog/<slug> на четырёх языках. Тексты описывают то,
 * что бот и панель делают сейчас (см. docs/COURSES-NICHE.md и страницы ниш);
 * цен в статьях нет — они на главной и берутся из реестра планов.
 */
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { SITE_URL } from "./config";

export const ARTICLE_SLUGS = [
  "telegram-sales-bot",
  "instagram-direct-sales",
  "online-school-bot",
] as const;
export type ArticleSlug = (typeof ARTICLE_SLUGS)[number];

export type ArticleSection = { h: string; p: string[] };
export type ArticleText = {
  /** Короткое имя для ссылок в подвале. */
  link: string;
  /** <title> страницы. */
  title: string;
  description: string;
  h1: string;
  lead: string;
  sections: ArticleSection[];
  cta: string;
};

/** Дата выхода статей (ISO) для разметки Article. */
export const ARTICLES_PUBLISHED = "2026-10-03";

export function isArticleSlug(v: unknown): v is ArticleSlug {
  return typeof v === "string" && (ARTICLE_SLUGS as readonly string[]).includes(v);
}

/** Адрес статьи на языке: русский — без параметра, как у главной. */
export function articleUrl(slug: ArticleSlug, locale: Locale): string {
  const base = `${SITE_URL}/blog/${slug}`;
  return locale === "ru" ? base : `${base}?lang=${locale}`;
}

/** Статьи для карты сайта: каждая на всех языках. */
export function articleSitemapLocs(): string[] {
  return ARTICLE_SLUGS.flatMap((s) => SUPPORTED_LOCALES.map((l) => articleUrl(s, l)));
}

export const ARTICLES: Record<ArticleSlug, Record<Locale, ArticleText>> = {
  "telegram-sales-bot": {
    ru: {
      link: "Бот для продаж в Telegram",
      title: "Бот для продаж в Telegram: как он работает и что даёт магазину — FrogFlow",
      description:
        "Как устроен бот для продаж в Telegram: каталог, корзина, оплата по реквизитам с проверкой чека, выдача файла после оплаты. Что настроить за вечер.",
      h1: "Бот для продаж в Telegram: как он работает и что даёт магазину",
      lead: "Бот для продаж — это магазин внутри мессенджера. Покупатель выбирает товар, оплачивает и получает заказ, а вы не сидите в личных сообщениях весь день.",
      sections: [
        {
          h: "Что умеет бот-магазин",
          p: [
            "Покупатель открывает бота, листает каталог по категориям, кладёт товары в корзину и оформляет заказ. Продавец видит заказ в панели и в Telegram, а статус заказа меняется по мере оплаты и выдачи.",
            "Бот отвечает на русском, казахском, английском и узбекском: язык выбирает покупатель, и все сообщения приходят на нём.",
          ],
        },
        {
          h: "Оплата без ручной переписки",
          p: [
            "Покупатель платит так, как привык: переводом по реквизитам, картой или по ссылке на оплату. После перевода он присылает чек прямо в бота.",
            "Чек проверяется автоматически: бот читает сумму и валюту, смотрит дату и отсекает повторно присланный файл. Если что-то не сходится, чек уходит продавцу с причиной, и решает человек. Так вы не смотрите каждый чек глазами, но спорные случаи не пропускаете.",
          ],
        },
        {
          h: "Цифровые товары выдаются сами",
          p: [
            "Если вы продаёте PDF, шаблоны, чек-листы или материалы, файл уходит покупателю сразу после подтверждения оплаты, в том числе ночью. Ссылка на файл подписана и действует ограниченное время.",
          ],
        },
        {
          h: "Что настроить за один вечер",
          p: [
            "Подключите бота, добавьте категории и товары с фото, укажите способы оплаты и напишите, как с вами связаться. Остальное бот делает сам: принимает заказы, напоминает об оплате и присылает вам уведомления.",
            "Платформа бесплатно пробуется несколько дней: можно собрать магазин, оформить тестовый заказ и посмотреть, как всё выглядит глазами покупателя.",
          ],
        },
      ],
      cta: "Попробовать бесплатно",
    },
    kk: {
      link: "Telegram-дағы сатылым боты",
      title: "Telegram-дағы сатылым боты: қалай жұмыс істейді және дүкенге не береді — FrogFlow",
      description:
        "Telegram-дағы сатылым боты қалай жұмыс істейді: каталог, себет, реквизит бойынша төлем және чекті тексеру, төлемнен кейін файл беру. Бір кеште не баптауға болады.",
      h1: "Telegram-дағы сатылым боты: қалай жұмыс істейді және дүкенге не береді",
      lead: "Сатылым боты — мессенджердің ішіндегі дүкен. Сатып алушы тауарды таңдап, төлейді және тапсырысын алады, ал сіз күні бойы жеке хабарламаларда отырмайсыз.",
      sections: [
        {
          h: "Бот-дүкен не істей алады",
          p: [
            "Сатып алушы ботты ашады, каталогты санаттар бойынша қарап, тауарларды себетке салады және тапсырыс береді. Сатушы тапсырысты панельден және Telegram-нан көреді, ал тапсырыс мәртебесі төлем мен беру барысына қарай өзгереді.",
            "Бот орыс, қазақ, ағылшын және өзбек тілдерінде жауап береді: тілді сатып алушы таңдайды, барлық хабарлама сол тілде келеді.",
          ],
        },
        {
          h: "Қолмен хат алмасусыз төлем",
          p: [
            "Сатып алушы өзіне ыңғайлы тәсілмен төлейді: реквизит бойынша аударым, карта немесе төлем сілтемесі. Аударымнан кейін чекті тікелей ботқа жібереді.",
            "Чек автоматты түрде тексеріледі: бот соманы мен валютаны оқиды, күнін қарайды және қайта жіберілген файлды қабылдамайды. Бірдеңе сәйкес келмесе, чек себебімен бірге сатушыға түседі, шешімді адам қабылдайды. Осылайша әр чекті көзбен қарамайсыз, бірақ даулы жағдайды өткізіп алмайсыз.",
          ],
        },
        {
          h: "Цифрлық тауарлар өздігінен беріледі",
          p: [
            "PDF, үлгілер, чек-парақтар немесе материалдар сатсаңыз, файл төлем расталған бойда, түнде де сатып алушыға жіберіледі. Файлға сілтеме қол қойылған және шектеулі уақыт жұмыс істейді.",
          ],
        },
        {
          h: "Бір кеште не баптауға болады",
          p: [
            "Ботты қосыңыз, санаттар мен тауарларды суретімен қосыңыз, төлем тәсілдерін көрсетіңіз және сізбен қалай байланысуға болатынын жазыңыз. Қалғанын бот өзі істейді: тапсырыс қабылдайды, төлемді еске салады және сізге хабарландыру жібереді.",
            "Платформаны бірнеше күн тегін байқап көруге болады: дүкен жасап, сынақ тапсырыс беріп, сатып алушының көзімен қалай көрінетінін қарай аласыз.",
          ],
        },
      ],
      cta: "Тегін байқап көру",
    },
    en: {
      link: "Telegram sales bot",
      title: "Telegram sales bot: how it works and what it gives your shop — FrogFlow",
      description:
        "How a Telegram sales bot works: catalog, cart, payment by bank details with receipt checking, file delivery after payment. What you can set up in an evening.",
      h1: "Telegram sales bot: how it works and what it gives your shop",
      lead: "A sales bot is a shop inside the messenger. The buyer picks a product, pays and gets the order, and you don't spend the whole day in private messages.",
      sections: [
        {
          h: "What a shop bot can do",
          p: [
            "The buyer opens the bot, browses the catalog by category, adds products to the cart and places an order. You see the order in the panel and in Telegram, and its status changes as it is paid and delivered.",
            "The bot speaks Russian, Kazakh, English and Uzbek: the buyer picks the language and every message arrives in it.",
          ],
        },
        {
          h: "Payment without manual back-and-forth",
          p: [
            "Buyers pay the way they are used to: a transfer to your bank details, a card, or a payment link. After a transfer they send the receipt straight to the bot.",
            "The receipt is checked automatically: the bot reads the amount and currency, looks at the date and rejects a file that was already used. If anything doesn't add up, the receipt goes to you with the reason and a person decides. You stop eyeballing every receipt without letting doubtful ones through.",
          ],
        },
        {
          h: "Digital products are delivered automatically",
          p: [
            "If you sell PDFs, templates, checklists or learning materials, the file goes to the buyer as soon as the payment is confirmed, including at night. The file link is signed and works for a limited time.",
          ],
        },
        {
          h: "What to set up in one evening",
          p: [
            "Connect the bot, add categories and products with photos, list your payment methods and say how to reach you. The bot does the rest: it takes orders, reminds buyers to pay and notifies you.",
            "You can try the platform free for a few days: build a shop, place a test order and see how it looks to a buyer.",
          ],
        },
      ],
      cta: "Try it free",
    },
    uz: {
      link: "Telegram’dagi savdo boti",
      title: "Telegram’dagi savdo boti: u qanday ishlaydi va do‘konga nima beradi — FrogFlow",
      description:
        "Telegram’dagi savdo boti qanday ishlaydi: katalog, savat, rekvizit bo‘yicha to‘lov va chekni tekshirish, to‘lovdan keyin fayl yuborish. Bir kechada nimalarni sozlash mumkin.",
      h1: "Telegram’dagi savdo boti: u qanday ishlaydi va do‘konga nima beradi",
      lead: "Savdo boti — messenjer ichidagi do‘kon. Xaridor mahsulotni tanlaydi, to‘laydi va buyurtmasini oladi, siz esa kun bo‘yi shaxsiy xabarlarda o‘tirmaysiz.",
      sections: [
        {
          h: "Bot-do‘kon nimalarni qila oladi",
          p: [
            "Xaridor botni ochadi, katalogni toifalar bo‘yicha ko‘radi, mahsulotlarni savatga soladi va buyurtma beradi. Sotuvchi buyurtmani panelda va Telegram’da ko‘radi, buyurtma holati to‘lov va yetkazib berish bosqichiga qarab o‘zgaradi.",
            "Bot rus, qozoq, ingliz va o‘zbek tillarida javob beradi: tilni xaridor tanlaydi, barcha xabarlar shu tilda keladi.",
          ],
        },
        {
          h: "Qo‘lda yozishmasiz to‘lov",
          p: [
            "Xaridor o‘ziga qulay usulda to‘laydi: rekvizitga o‘tkazma, karta yoki to‘lov havolasi. O‘tkazmadan keyin chekni to‘g‘ridan-to‘g‘ri botga yuboradi.",
            "Chek avtomatik tekshiriladi: bot summa va valyutani o‘qiydi, sanasiga qaraydi va qayta yuborilgan faylni qabul qilmaydi. Biror narsa mos kelmasa, chek sababi bilan sotuvchiga tushadi va qarorni inson qabul qiladi. Shunday qilib har bir chekni ko‘z bilan tekshirmaysiz, lekin shubhali holatlar ham e’tibordan chetda qolmaydi.",
          ],
        },
        {
          h: "Raqamli mahsulotlar o‘zi yetkaziladi",
          p: [
            "PDF, shablon, chek-varaq yoki o‘quv materiallari sotsangiz, fayl to‘lov tasdiqlanishi bilanoq, tunda ham xaridorga yuboriladi. Faylga havola imzolangan va cheklangan vaqt amal qiladi.",
          ],
        },
        {
          h: "Bir kechada nimalarni sozlash mumkin",
          p: [
            "Botni ulang, toifalar va mahsulotlarni rasmlari bilan qo‘shing, to‘lov usullarini ko‘rsating va siz bilan qanday bog‘lanish mumkinligini yozing. Qolganini bot o‘zi bajaradi: buyurtma qabul qiladi, to‘lovni eslatadi va sizga xabar yuboradi.",
            "Platformani bir necha kun bepul sinab ko‘rish mumkin: do‘kon yarating, sinov buyurtmasini bering va xaridor ko‘zi bilan qanday ko‘rinishini ko‘ring.",
          ],
        },
      ],
      cta: "Bepul sinab ko‘rish",
    },
  },
  "instagram-direct-sales": {
    ru: {
      link: "Продажи в Instagram Direct",
      title: "Продажи в Instagram Direct: как не терять заказы в личных сообщениях — FrogFlow",
      description:
        "Как продавать через Instagram Direct без хаоса: автоответ на комментарий с ключевым словом, каталог и оплата в переписке, один покупатель во всех каналах.",
      h1: "Продажи в Instagram Direct: как не терять заказы в личных сообщениях",
      lead: "В Instagram покупатели пишут в директ, в комментарии и в истории. Без порядка часть обращений теряется, а ответ «сколько стоит» отнимает полдня.",
      sections: [
        {
          h: "Откуда берутся потерянные заказы",
          p: [
            "Человек пишет вечером, вы отвечаете утром, и он уже купил у другого. Или спрашивает цену в комментарии под постом, а ответ уходит в общую ленту. Чем больше подписчиков, тем больше таких обращений.",
          ],
        },
        {
          h: "Комментарий с ключевым словом открывает диалог",
          p: [
            "Вы просите в посте написать слово, например «цена» или «хочу». Бот замечает комментарий по правилам, которые вы задали, и сам пишет автору в директ с нужной ссылкой или каталогом. Правила настраиваются в панели: какое слово, на какой пост и что отправить.",
          ],
        },
        {
          h: "Каталог и оплата прямо в переписке",
          p: [
            "В директе бот показывает товары, собирает заказ и называет реквизиты для оплаты. Чек можно прислать в тот же чат: он проверяется автоматически, а спорные случаи уходят вам с причиной.",
            "Instagram даёт отвечать в течение ограниченного окна после сообщения покупателя. Поэтому бот отвечает сразу, а материалы для цифровых заказов могут уходить подписанной ссылкой или письмом.",
          ],
        },
        {
          h: "Один покупатель во всех каналах",
          p: [
            "Если один человек пишет вам в Instagram, WhatsApp и Telegram, платформа видит в нём одного покупателя: история заказов, баллы и заметки не раздваиваются. Все каналы подключаются в одной панели, а магазин работает на одной базе товаров.",
          ],
        },
      ],
      cta: "Подключить Instagram",
    },
    kk: {
      link: "Instagram Direct-тегі сатылым",
      title:
        "Instagram Direct-тегі сатылым: жеке хабарламалардағы тапсырыстарды жоғалтпау жолы — FrogFlow",
      description:
        "Instagram Direct арқылы бей-берекетсіз сатудың жолы: кілт сөзі бар пікірге автожауап, жазбадағы каталог пен төлем, барлық арнада бір сатып алушы.",
      h1: "Instagram Direct-тегі сатылым: жеке хабарламалардағы тапсырыстарды жоғалтпау жолы",
      lead: "Instagram-да сатып алушылар директке, пікірлерге және тарихқа жазады. Тәртіп болмаса, өтініштердің бір бөлігі жоғалады, ал «қанша тұрады» деген сұраққа жауап беру жарты күнді алады.",
      sections: [
        {
          h: "Жоғалған тапсырыстар қайдан шығады",
          p: [
            "Адам кешке жазады, сіз таңертең жауап бересіз, ал ол басқа жерден сатып алып қойған. Немесе бағасын посттың астындағы пікірден сұрайды, ал жауап ортақ лентаға кетеді. Жазылушы көп болған сайын мұндай өтініштер де көбейеді.",
          ],
        },
        {
          h: "Кілт сөзі бар пікір диалогты ашады",
          p: [
            "Постта «баға» немесе «қалаймын» сияқты сөзді жазуды сұрайсыз. Бот пікірді өзіңіз берген ережелер бойынша байқап, автордың директіне қажетті сілтемемен немесе каталогпен өзі жазады. Ережелер панельде бапталады: қандай сөз, қай пост және не жіберу керек.",
          ],
        },
        {
          h: "Каталог пен төлем тікелей жазбада",
          p: [
            "Директте бот тауарларды көрсетеді, тапсырыс жинайды және төлем реквизитін айтады. Чекті сол чатқа жіберуге болады: ол автоматты түрде тексеріледі, даулы жағдайлар сізге себебімен түседі.",
            "Instagram сатып алушының хабарламасынан кейін шектеулі уақыт ішінде ғана жауап беруге мүмкіндік береді. Сондықтан бот бірден жауап береді, ал цифрлық тапсырыстың материалдары қол қойылған сілтемемен немесе хатпен жіберіле алады.",
          ],
        },
        {
          h: "Барлық арнада бір сатып алушы",
          p: [
            "Бір адам сізге Instagram, WhatsApp және Telegram-да жазса, платформа оны бір сатып алушы деп көреді: тапсырыс тарихы, баллдар мен жазбалар екіге бөлінбейді. Барлық арналар бір панельде қосылады, ал дүкен бір тауар базасымен жұмыс істейді.",
          ],
        },
      ],
      cta: "Instagram қосу",
    },
    en: {
      link: "Instagram Direct sales",
      title: "Selling in Instagram Direct: how not to lose orders in private messages — FrogFlow",
      description:
        "How to sell through Instagram Direct without chaos: auto-reply to a keyword comment, catalog and payment in the chat, one buyer across all channels.",
      h1: "Selling in Instagram Direct: how not to lose orders in private messages",
      lead: "On Instagram buyers write in direct, in comments and in stories. Without order, some of them get lost, and answering “how much is it” takes half a day.",
      sections: [
        {
          h: "Where lost orders come from",
          p: [
            "Someone writes in the evening, you answer in the morning, and they have already bought elsewhere. Or they ask the price in a comment under a post and the reply lands in the public feed. The more followers you have, the more of these there are.",
          ],
        },
        {
          h: "A keyword comment opens the conversation",
          p: [
            "In a post you ask people to write a word, for example “price” or “want”. The bot notices the comment by the rules you set and messages the author in direct with the right link or catalog. The rules are set in the panel: which word, on which post and what to send.",
          ],
        },
        {
          h: "Catalog and payment right in the chat",
          p: [
            "In direct the bot shows products, collects the order and gives the payment details. The receipt can be sent to the same chat: it is checked automatically, and doubtful ones come to you with the reason.",
            "Instagram lets you reply only within a limited window after the buyer's message. That is why the bot answers at once, and materials for digital orders can go as a signed link or by email.",
          ],
        },
        {
          h: "One buyer across all channels",
          p: [
            "If one person writes to you on Instagram, WhatsApp and Telegram, the platform sees a single buyer: order history, points and notes are not split. All channels connect in one panel and the shop runs on one product base.",
          ],
        },
      ],
      cta: "Connect Instagram",
    },
    uz: {
      link: "Instagram Direct’dagi savdo",
      title:
        "Instagram Direct’dagi savdo: shaxsiy xabarlarda buyurtmalarni yo‘qotmaslik yo‘li — FrogFlow",
      description:
        "Instagram Direct orqali tartibsizliksiz sotish: kalit so‘zli izohga avtojavob, yozishmadagi katalog va to‘lov, barcha kanallarda bitta xaridor.",
      h1: "Instagram Direct’dagi savdo: shaxsiy xabarlarda buyurtmalarni yo‘qotmaslik yo‘li",
      lead: "Instagramda xaridorlar direktga, izohlarga va storisga yozadi. Tartib bo‘lmasa, murojaatlarning bir qismi yo‘qoladi, «qancha turadi» degan savolga javob berish esa yarim kunni oladi.",
      sections: [
        {
          h: "Yo‘qolgan buyurtmalar qayerdan paydo bo‘ladi",
          p: [
            "Odam kechqurun yozadi, siz ertalab javob berasiz, u esa boshqa joydan sotib olib bo‘lgan. Yoki narxni post ostidagi izohda so‘raydi, javob esa umumiy lentaga tushadi. Obunachilar qancha ko‘p bo‘lsa, bunday murojaatlar ham shuncha ko‘p bo‘ladi.",
          ],
        },
        {
          h: "Kalit so‘zli izoh suhbatni boshlaydi",
          p: [
            "Postda «narx» yoki «istayman» kabi so‘z yozishni so‘raysiz. Bot izohni siz belgilagan qoidalar bo‘yicha payqaydi va muallifga direktda kerakli havola yoki katalog bilan o‘zi yozadi. Qoidalar panelda sozlanadi: qaysi so‘z, qaysi post va nima yuborish kerak.",
          ],
        },
        {
          h: "Katalog va to‘lov to‘g‘ridan-to‘g‘ri yozishmada",
          p: [
            "Direktda bot mahsulotlarni ko‘rsatadi, buyurtmani yig‘adi va to‘lov rekvizitini aytadi. Chekni shu chatga yuborish mumkin: u avtomatik tekshiriladi, shubhali holatlar sababi bilan sizga tushadi.",
            "Instagram xaridor xabaridan keyin faqat cheklangan vaqt ichida javob berishga imkon beradi. Shuning uchun bot darhol javob beradi, raqamli buyurtma materiallari esa imzolangan havola yoki xat bilan yuborilishi mumkin.",
          ],
        },
        {
          h: "Barcha kanallarda bitta xaridor",
          p: [
            "Bir odam sizga Instagram, WhatsApp va Telegram’da yozsa, platforma uni bitta xaridor deb ko‘radi: buyurtmalar tarixi, ballar va qaydlar ikkiga bo‘linmaydi. Barcha kanallar bitta panelda ulanadi, do‘kon esa yagona mahsulot bazasida ishlaydi.",
          ],
        },
      ],
      cta: "Instagram’ni ulash",
    },
  },
  "online-school-bot": {
    ru: {
      link: "Бот для онлайн-школы",
      title: "Бот для онлайн-школы: продажа курсов, уроки и домашние задания в Telegram — FrogFlow",
      description:
        "Как запустить онлайн-школу в Telegram: оплата курса, доступ в закрытый канал, уроки по расписанию, домашние задания и проверка. Что делает бот, а что остаётся вам.",
      h1: "Бот для онлайн-школы: продажа курсов, уроки и домашние задания в Telegram",
      lead: "Школе в мессенджере нужны четыре вещи: принять оплату, открыть доступ, вести учеников по урокам и проверять домашние задания. Бот берёт эту рутину на себя.",
      sections: [
        {
          h: "Оплата и доступ без ручной работы",
          p: [
            "Ученик выбирает курс и тариф, платит, и доступ открывается сразу после подтверждения оплаты: бот присылает ссылку в закрытый канал курса. Не нужно добавлять каждого вручную и проверять каждый платёж, прежде чем дать доступ.",
            "Если нужен возврат, доступ закрывается: ученика исключают из канала, а результат остаётся в истории заказа.",
          ],
        },
        {
          h: "Потоки, тарифы и расписание уроков",
          p: [
            "Курс можно запускать потоками: у каждого свои даты старта. Тарифы курса различаются составом, например с проверкой домашних заданий и без. Уроки открываются по расписанию без вас, а когда открывается новый урок, бот пишет ученику.",
            "Урок может быть текстом, видео или файлом. Ученик возвращается к материалам в разделе «Мои курсы» в боте.",
          ],
        },
        {
          h: "Домашние задания и обратная связь",
          p: [
            "Ученик сдаёт работу прямо в боте, преподаватель смотрит её в панели и отвечает. Ответ приходит ученику в тот же чат, а все работы собраны в одном списке, а не в десятках переписок.",
          ],
        },
        {
          h: "С чего начать",
          p: [
            "Создайте магазин с нишей «Онлайн-школа», добавьте курс с уроками и тарифами, подключите закрытый канал и способ оплаты. Платформа подсказывает шаги запуска на обзоре панели. Попробуйте на пробном периоде, пока первые ученики не пришли.",
          ],
        },
      ],
      cta: "Открыть школу",
    },
    kk: {
      link: "Онлайн-мектепке арналған бот",
      title:
        "Онлайн-мектепке арналған бот: курс сату, сабақтар және Telegram-дағы үй тапсырмалары — FrogFlow",
      description:
        "Telegram-да онлайн-мектепті қалай іске қосуға болады: курсқа төлем, жабық арнаға қолжетімділік, кесте бойынша сабақтар, үй тапсырмалары және тексеру. Бот не істейді, сізге не қалады.",
      h1: "Онлайн-мектепке арналған бот: курс сату, сабақтар және Telegram-дағы үй тапсырмалары",
      lead: "Мессенджердегі мектепке төрт нәрсе керек: төлемді қабылдау, қолжетімділік ашу, оқушыларды сабақтар бойынша жүргізу және үй тапсырмасын тексеру. Бот осы күнделікті жұмысты өз мойнына алады.",
      sections: [
        {
          h: "Қолмен жұмыссыз төлем және қолжетімділік",
          p: [
            "Оқушы курс пен тарифті таңдап, төлейді, ал төлем расталған бойда қолжетімділік ашылады: бот курстың жабық арнасына сілтеме жібереді. Әр оқушыны қолмен қосып, қолжетімділік бергенше әр төлемді тексерудің қажеті жоқ.",
            "Қайтару қажет болса, қолжетімділік жабылады: оқушы арнадан шығарылады, ал нәтиже тапсырыс тарихында қалады.",
          ],
        },
        {
          h: "Ағындар, тарифтер және сабақ кестесі",
          p: [
            "Курсты ағындармен іске қосуға болады: әрқайсысының өз басталу күні бар. Курс тарифтері құрамымен ерекшеленеді, мысалы үй тапсырмасын тексерумен және онсыз. Сабақтар кесте бойынша сіздің қатысуыңызсыз ашылады, ал жаңа сабақ ашылғанда бот оқушыға жазады.",
            "Сабақ мәтін, бейне немесе файл болуы мүмкін. Оқушы материалдарға боттағы «Менің курстарым» бөлімінде оралады.",
          ],
        },
        {
          h: "Үй тапсырмалары және кері байланыс",
          p: [
            "Оқушы жұмысын тікелей ботта тапсырады, оқытушы оны панельде қарап, жауап береді. Жауап оқушыға сол чатқа келеді, ал барлық жұмыс ондаған жазбада емес, бір тізімде жиналған.",
          ],
        },
        {
          h: "Неден бастау керек",
          p: [
            "«Онлайн-мектеп» нишасымен дүкен жасаңыз, сабақтары мен тарифтері бар курсты қосыңыз, жабық арна мен төлем тәсілін қосыңыз. Платформа іске қосу қадамдарын панельдің шолу бетінде ұсынады. Алғашқы оқушылар келгенге дейін сынақ мерзімінде байқап көріңіз.",
          ],
        },
      ],
      cta: "Мектеп ашу",
    },
    en: {
      link: "Online school bot",
      title: "Online school bot: selling courses, lessons and homework in Telegram — FrogFlow",
      description:
        "How to run an online school in Telegram: course payment, access to a private channel, scheduled lessons, homework and review. What the bot does and what stays with you.",
      h1: "Online school bot: selling courses, lessons and homework in Telegram",
      lead: "A school in a messenger needs four things: take payment, open access, guide students through lessons and review homework. The bot takes this routine off your hands.",
      sections: [
        {
          h: "Payment and access without manual work",
          p: [
            "A student picks a course and a tier, pays, and access opens as soon as the payment is confirmed: the bot sends a link to the course's private channel. You don't add every student by hand or check every payment before granting access.",
            "If a refund is needed, access closes: the student is removed from the channel and the result stays in the order history.",
          ],
        },
        {
          h: "Cohorts, tiers and lesson schedule",
          p: [
            "A course can run in cohorts, each with its own start date. Course tiers differ in what they include, for example with or without homework review. Lessons open on schedule without you, and when a new lesson opens the bot messages the student.",
            "A lesson can be text, video or a file. Students come back to the materials in the “My courses” section of the bot.",
          ],
        },
        {
          h: "Homework and feedback",
          p: [
            "A student hands in work right in the bot, the teacher reviews it in the panel and replies. The reply reaches the student in the same chat, and all submissions are collected in one list instead of dozens of conversations.",
          ],
        },
        {
          h: "Where to start",
          p: [
            "Create a shop with the “Online school” niche, add a course with lessons and tiers, connect a private channel and a payment method. The platform suggests launch steps on the panel overview. Try it during the trial before your first students arrive.",
          ],
        },
      ],
      cta: "Open your school",
    },
    uz: {
      link: "Onlayn maktab uchun bot",
      title:
        "Onlayn maktab uchun bot: Telegram’da kurs sotish, darslar va uy vazifalari — FrogFlow",
      description:
        "Telegram’da onlayn maktabni qanday ishga tushirish mumkin: kurs uchun to‘lov, yopiq kanalga kirish, jadval bo‘yicha darslar, uy vazifalari va tekshirish. Bot nima qiladi, sizga nima qoladi.",
      h1: "Onlayn maktab uchun bot: Telegram’da kurs sotish, darslar va uy vazifalari",
      lead: "Messenjerdagi maktabga to‘rtta narsa kerak: to‘lovni qabul qilish, kirishni ochish, o‘quvchilarni darslar bo‘ylab olib borish va uy vazifalarini tekshirish. Bot bu kundalik ishni o‘z zimmasiga oladi.",
      sections: [
        {
          h: "Qo‘lda ishsiz to‘lov va kirish",
          p: [
            "O‘quvchi kurs va tarifni tanlaydi, to‘laydi, to‘lov tasdiqlanishi bilanoq kirish ochiladi: bot kursning yopiq kanaliga havola yuboradi. Har bir o‘quvchini qo‘lda qo‘shish va kirish berishdan oldin har bir to‘lovni tekshirish shart emas.",
            "Pulni qaytarish kerak bo‘lsa, kirish yopiladi: o‘quvchi kanaldan chiqariladi, natija esa buyurtma tarixida qoladi.",
          ],
        },
        {
          h: "Oqimlar, tariflar va dars jadvali",
          p: [
            "Kursni oqimlar bilan ishga tushirish mumkin: har birining o‘z boshlanish sanasi bor. Kurs tariflari tarkibi bilan farqlanadi, masalan uy vazifasini tekshirish bilan va unsiz. Darslar jadval bo‘yicha sizning ishtirokingizsiz ochiladi, yangi dars ochilganda bot o‘quvchiga yozadi.",
            "Dars matn, video yoki fayl bo‘lishi mumkin. O‘quvchi materiallarga botdagi «Mening kurslarim» bo‘limida qaytadi.",
          ],
        },
        {
          h: "Uy vazifalari va fikr-mulohaza",
          p: [
            "O‘quvchi ishini to‘g‘ridan-to‘g‘ri botda topshiradi, o‘qituvchi uni panelda ko‘rib, javob beradi. Javob o‘quvchiga o‘sha chatda keladi, barcha ishlar esa o‘nlab yozishmalarda emas, bitta ro‘yxatda jamlangan.",
          ],
        },
        {
          h: "Nimadan boshlash kerak",
          p: [
            "«Onlayn maktab» nishasi bilan do‘kon yarating, darslar va tariflar bilan kurs qo‘shing, yopiq kanal va to‘lov usulini ulang. Platforma ishga tushirish qadamlarini panelning umumiy ko‘rinishida taklif qiladi. Birinchi o‘quvchilar kelguncha sinov muddatida sinab ko‘ring.",
          ],
        },
      ],
      cta: "Maktab ochish",
    },
  },
};
