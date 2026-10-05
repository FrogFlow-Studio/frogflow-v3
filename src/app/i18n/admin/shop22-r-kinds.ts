import type { SectionDict } from "../section";

/** Путь Р, Р2: шаблон магазина по типу (core/templates/shop-kind). */
export const ru = {
  "shopKind.title": "Шаблон магазина",
  "shopKind.intro":
    "Выберите, что вы продаёте: подготовим категории, тексты страницы «О магазине» и настройки выдачи и оплаты. Всё потом можно изменить. Шаблон ставится только в пустой магазин; уже написанные вами тексты и настройки не меняются.",
  "shopKind.digital": "Цифровые материалы",
  "shopKind.digitalHint": "Файлы и ссылки после оплаты, без доставки.",
  "shopKind.goods": "Товары с доставкой",
  "shopKind.goodsHint": "Самовывоз и доставка, оплата полностью.",
  "shopKind.services": "Услуги и курсы",
  "shopKind.servicesHint": "Без доставки, детали согласуются после оплаты.",
  "shopKind.confirm": "Применить шаблон? Будут созданы категории и заполнены тексты и настройки.",
  "err.shopKind.notEmpty":
    "Шаблон ставится только в пустой магазин — у вас уже есть товары или категории.",
  "err.shopKind.busy": "Шаблон уже применяется — подождите минуту.",
};

export const kk: SectionDict<typeof ru> = {
  "shopKind.title": "Дүкен үлгісі",
  "shopKind.intro":
    "Не сатасыз, соны таңдаңыз: санаттарды, «Дүкен туралы» бетінің мәтіндерін және беру мен төлем баптауларын дайындаймыз. Барлығын кейін өзгертуге болады. Үлгі тек бос дүкенге қойылады; өзіңіз жазған мәтіндер мен баптаулар өзгермейді.",
  "shopKind.digital": "Цифрлық материалдар",
  "shopKind.digitalHint": "Төлемнен кейін файлдар мен сілтемелер, жеткізусіз.",
  "shopKind.goods": "Жеткізілетін тауарлар",
  "shopKind.goodsHint": "Өзі алып кету және жеткізу, толық төлем.",
  "shopKind.services": "Қызметтер мен курстар",
  "shopKind.servicesHint": "Жеткізусіз, егжей-тегжейі төлемнен кейін келісіледі.",
  "shopKind.confirm":
    "Үлгіні қолдану керек пе? Санаттар жасалып, мәтіндер мен баптаулар толтырылады.",
  "err.shopKind.notEmpty": "Үлгі тек бос дүкенге қойылады — сізде тауарлар немесе санаттар бар.",
  "err.shopKind.busy": "Үлгі қолданылып жатыр — бір минут күтіңіз.",
};

export const en: SectionDict<typeof ru> = {
  "shopKind.title": "Shop template",
  "shopKind.intro":
    "Pick what you sell: we will prepare categories, the About page texts and the delivery and payment settings. You can change everything later. The template only goes into an empty shop; texts and settings you already wrote stay as they are.",
  "shopKind.digital": "Digital materials",
  "shopKind.digitalHint": "Files and links after payment, no delivery.",
  "shopKind.goods": "Products with delivery",
  "shopKind.goodsHint": "Pickup and delivery, payment in full.",
  "shopKind.services": "Services and courses",
  "shopKind.servicesHint": "No delivery, details agreed after payment.",
  "shopKind.confirm":
    "Apply the template? Categories will be created and texts and settings filled in.",
  "err.shopKind.notEmpty":
    "The template only goes into an empty shop — you already have products or categories.",
  "err.shopKind.busy": "The template is already being applied — wait a minute.",
};

export const uz: SectionDict<typeof ru> = {
  "shopKind.title": "Do‘kon shabloni",
  "shopKind.intro":
    "Nima sotishingizni tanlang: kategoriyalar, «Do‘kon haqida» sahifasi matnlari hamda berish va to‘lov sozlamalarini tayyorlaymiz. Hammasini keyin o‘zgartirish mumkin. Shablon faqat bo‘sh do‘konga qo‘yiladi; o‘zingiz yozgan matn va sozlamalar o‘zgarmaydi.",
  "shopKind.digital": "Raqamli materiallar",
  "shopKind.digitalHint": "To‘lovdan keyin fayl va havolalar, yetkazib berishsiz.",
  "shopKind.goods": "Yetkazib beriladigan mahsulotlar",
  "shopKind.goodsHint": "O‘zi olib ketish va yetkazib berish, to‘liq to‘lov.",
  "shopKind.services": "Xizmatlar va kurslar",
  "shopKind.servicesHint": "Yetkazib berishsiz, tafsilotlar to‘lovdan keyin kelishiladi.",
  "shopKind.confirm":
    "Shablon qo‘llansinmi? Kategoriyalar yaratiladi, matn va sozlamalar to‘ldiriladi.",
  "err.shopKind.notEmpty":
    "Shablon faqat bo‘sh do‘konga qo‘yiladi — sizda mahsulot yoki kategoriya bor.",
  "err.shopKind.busy": "Shablon qo‘llanmoqda — bir daqiqa kuting.",
};
