/**
 * Шаблоны ниш: стартовые категории и примеры товаров, чтобы новый магазин не
 * открывался пустым. Примеры создаются скрытыми (is_active = false) и с
 * пометкой «Пример» в названии: покупатель их не видит, продавец правит
 * фото, цену и текст и включает. Цифровому примеру продавец добавит файл —
 * без него карточку не сохранить (err.admin.digitalNeedsFile).
 *
 * Тексты — на четырёх языках магазина: ru, kk, en, uz (латиница). Язык примера
 * берётся из default_locale магазина.
 */
import type { Locale } from "@/core/i18n/locale";
import type { VerticalKey } from "@/core/verticals/registry";

type Text = Record<Locale, string>;

export type TemplateProduct = {
  name: Text;
  description: Text;
  /** Цена в тенге; магазин с другой валютой получает то же число — это пример. */
  price: number;
  /** Индекс категории в `categories` шаблона. */
  category: number;
  kind: "digital" | "physical";
  leadTimeDays?: number;
};

export type NicheTemplate = { categories: Text[]; products: TemplateProduct[] };

const P = (
  category: number,
  kind: "digital" | "physical",
  price: number,
  ru: [string, string],
  kk: [string, string],
  en: [string, string],
  uz: [string, string],
  leadTimeDays?: number,
): TemplateProduct => ({
  category,
  kind,
  price,
  name: { ru: ru[0], kk: kk[0], en: en[0], uz: uz[0] },
  description: { ru: ru[1], kk: kk[1], en: en[1], uz: uz[1] },
  leadTimeDays,
});

const digital: NicheTemplate = {
  categories: [
    {
      ru: "Дошкольникам",
      kk: "Мектепке дейінгілерге",
      en: "Preschoolers",
      uz: "Maktabgacha yoshdagilar uchun",
    },
    { ru: "Начальная школа", kk: "Бастауыш сынып", en: "Primary school", uz: "Boshlang‘ich sinf" },
    { ru: "Педагогам", kk: "Педагогтерге", en: "For teachers", uz: "Pedagoglar uchun" },
  ],
  products: [
    P(
      0,
      "digital",
      1500,
      [
        "Прописи для подготовки к школе",
        "40 листов в PDF: линии, буквы и цифры. Распечатайте на А4 и занимайтесь дома. Файл придёт в бот сразу после оплаты.",
      ],
      [
        "Мектепке дайындыққа арналған жазу дәптері",
        "PDF-тегі 40 бет: сызықтар, әріптер мен сандар. А4 форматта басып шығарып, үйде жаттығыңыз. Файл төлемнен кейін бірден ботқа келеді.",
      ],
      [
        "Writing practice book for school prep",
        "40 pages in PDF: lines, letters and numbers. Print on A4 and practise at home. The file arrives in the bot right after payment.",
      ],
      [
        "Maktabga tayyorlov uchun yozuv daftari",
        "PDF formatida 40 varaq: chiziqlar, harflar va raqamlar. A4 da chop etib, uyda mashq qiling. Fayl to‘lovdan so‘ng darhol botga keladi.",
      ],
    ),
    P(
      1,
      "digital",
      2500,
      [
        "Рабочая тетрадь по математике, 1 класс",
        "Задания на сложение и вычитание в пределах 20, с ответами для родителя. PDF, 60 страниц.",
      ],
      [
        "Математикадан жұмыс дәптері, 1-сынып",
        "20 көлеміндегі қосу мен азайтуға тапсырмалар, ата-анаға арналған жауаптарымен. PDF, 60 бет.",
      ],
      [
        "Maths workbook, grade 1",
        "Addition and subtraction within 20, with answers for the parent. PDF, 60 pages.",
      ],
      [
        "Matematikadan ish daftari, 1-sinf",
        "20 ichida qo‘shish va ayirish topshiriqlari, ota-onaga javoblar bilan. PDF, 60 bet.",
      ],
    ),
    P(
      2,
      "digital",
      4900,
      [
        "Комплект наглядных материалов к уроку",
        "Карточки, плакаты и раздаточный материал к одной теме. Архив PDF для печати.",
      ],
      [
        "Сабаққа арналған көрнекі материалдар жиынтығы",
        "Бір тақырыпқа арналған карточкалар, плакаттар мен үлестірме материал. Басып шығаруға арналған PDF мұрағаты.",
      ],
      [
        "Visual aids set for a lesson",
        "Cards, posters and handouts for one topic. A PDF archive for printing.",
      ],
      [
        "Dars uchun ko‘rgazmali materiallar to‘plami",
        "Bitta mavzu bo‘yicha kartochkalar, plakatlar va tarqatma materiallar. Chop etish uchun PDF arxivi.",
      ],
    ),
  ],
};

const confectionery: NicheTemplate = {
  categories: [
    { ru: "Торты", kk: "Торттар", en: "Cakes", uz: "Tortlar" },
    { ru: "Десерты", kk: "Десерттер", en: "Desserts", uz: "Shirinliklar" },
  ],
  products: [
    P(
      0,
      "physical",
      12000,
      [
        "Торт «Медовик», 1 кг",
        "Нежные медовые коржи и сметанный крем. Надпись на торте — бесплатно, укажите её в комментарии к заказу. Готовим к выбранной дате.",
      ],
      [
        "«Бал» торты, 1 кг",
        "Жұмсақ балды қабаттар мен қаймақ кремі. Торттағы жазу — тегін, оны тапсырысқа түсініктемеде жазыңыз. Таңдалған күнге дайындаймыз.",
      ],
      [
        "Honey cake «Medovik», 1 kg",
        "Tender honey layers and sour cream filling. Writing on the cake is free: add it in the order comment. Baked for your chosen date.",
      ],
      [
        "«Asalli» torti, 1 kg",
        "Yumshoq asalli qatlamlar va qaymoqli krem. Tortdagi yozuv — bepul, uni buyurtma izohiga yozing. Tanlangan sanaga tayyorlaymiz.",
      ],
      2,
    ),
    P(
      0,
      "physical",
      18000,
      [
        "Бенто-торт с рисунком",
        "Маленький торт на двоих с вашим рисунком или надписью. Пришлите картинку в чат после заказа.",
      ],
      [
        "Суреті бар бенто-торт",
        "Сіздің суретіңіз немесе жазуыңыз бар екі адамға арналған шағын торт. Тапсырыстан кейін суретті чатқа жіберіңіз.",
      ],
      [
        "Bento cake with a picture",
        "A small cake for two with your picture or lettering. Send the image in the chat after ordering.",
      ],
      [
        "Rasmli bento-tort",
        "Ikki kishilik, sizning rasmingiz yoki yozuvingiz bilan kichik tort. Buyurtmadan so‘ng rasmni chatga yuboring.",
      ],
      1,
    ),
    P(
      1,
      "physical",
      6000,
      ["Капкейки, 6 штук", "Ванильные капкейки с кремом. Цвет крема выберите в комментарии."],
      [
        "Капкейктер, 6 дана",
        "Кремі бар ванильді капкейктер. Кремнің түсін түсініктемеде таңдаңыз.",
      ],
      ["Cupcakes, 6 pcs", "Vanilla cupcakes with cream. Choose the cream colour in the comment."],
      ["Kapkeyklar, 6 dona", "Kremli vanilli kapkeyklar. Krem rangini izohda tanlang."],
      1,
    ),
  ],
};

const flowers: NicheTemplate = {
  categories: [
    { ru: "Букеты", kk: "Гүл шоқтары", en: "Bouquets", uz: "Guldastalar" },
    {
      ru: "Цветы в коробке",
      kk: "Қораптағы гүлдер",
      en: "Flowers in a box",
      uz: "Qutidagi gullar",
    },
  ],
  products: [
    P(
      0,
      "physical",
      15000,
      [
        "Букет из 15 роз",
        "Свежие розы в крафтовой упаковке. Доставим к нужному времени, открытка с вашим текстом — бесплатно.",
      ],
      [
        "15 раушаннан тұратын гүл шоғы",
        "Крафт орамадағы балғын раушандар. Қажетті уақытқа жеткіземіз, сіздің мәтініңіз бар ашықхат — тегін.",
      ],
      [
        "Bouquet of 15 roses",
        "Fresh roses in kraft wrapping. Delivered at the time you need; a card with your message is free.",
      ],
      [
        "15 ta atirgulli guldasta",
        "Kraft qog‘ozga o‘ralgan yangi atirgullar. Kerakli vaqtga yetkazamiz, matningiz bilan otkritka — bepul.",
      ],
    ),
    P(
      0,
      "physical",
      11000,
      [
        "Сезонный букет от флориста",
        "Флорист соберёт букет из самых свежих цветов дня в выбранной гамме.",
      ],
      [
        "Флористтен маусымдық гүл шоғы",
        "Флорист таңдалған түстегі күннің ең балғын гүлдерінен гүл шоғын құрастырады.",
      ],
      [
        "Seasonal bouquet from the florist",
        "The florist will make a bouquet from the freshest flowers of the day in your chosen colours.",
      ],
      [
        "Florist tayyorlagan mavsumiy guldasta",
        "Florist tanlangan ranglarda kunning eng yangi gullaridan guldasta tuzadi.",
      ],
    ),
    P(
      1,
      "physical",
      19000,
      [
        "Цветы в шляпной коробке",
        "Композиция в коробке стоит без воды до 5 дней. Можно добавить сладости.",
      ],
      [
        "Қалпақ қорабындағы гүлдер",
        "Қораптағы композиция сусыз 5 күнге дейін тұрады. Тәттілер қосуға болады.",
      ],
      [
        "Flowers in a hat box",
        "The arrangement in the box stays fresh without water for up to 5 days. Sweets can be added.",
      ],
      [
        "Shlyapa qutisidagi gullar",
        "Qutidagi kompozitsiya 5 kungacha suvsiz turadi. Shirinliklar qo‘shish mumkin.",
      ],
    ),
  ],
};

/** Консультант: прайс, по которому ИИ отвечает в Direct. */
const consultant: NicheTemplate = {
  categories: [{ ru: "Прайс", kk: "Баға тізімі", en: "Price list", uz: "Narxlar" }],
  products: [
    P(
      0,
      "physical",
      25000,
      [
        "Комплект постельного белья, евро",
        "Сатин, 100% хлопок. Наволочки 50×70 и 70×70. Уточните цвет у менеджера.",
      ],
      [
        "Төсек-орын жиынтығы, евро",
        "Сатин, 100% мақта. Жастық тыстары 50×70 және 70×70. Түсін менеджерден нақтылаңыз.",
      ],
      [
        "Bed linen set, euro size",
        "Satin, 100% cotton. Pillowcases 50×70 and 70×70. Ask the manager about colours.",
      ],
      [
        "Choyshab to‘plami, yevro",
        "Satin, 100% paxta. Yostiq jildlari 50×70 va 70×70. Rangini menejerdan so‘rang.",
      ],
    ),
    P(
      0,
      "physical",
      9000,
      ["Плед, 150×200", "Мягкий плед из микрофибры, несколько цветов в наличии."],
      ["Throw blanket, 150×200", "Soft microfibre blanket, several colours in stock."],
      ["Pled, 150×200", "Mikrofibradan yumshoq pled, bir necha rangda mavjud."],
      ["Плед, 150×200", "Микрофибрадан жасалған жұмсақ плед, бірнеше түсі бар."],
    ),
  ],
};

/** Универсальный консультант: услуга и товар, которые продавец заменит своими. */
const universal: NicheTemplate = {
  categories: [{ ru: "Прайс", kk: "Баға тізімі", en: "Price list", uz: "Narxlar" }],
  products: [
    P(
      0,
      "physical",
      10000,
      [
        "Консультация специалиста, 1 час",
        "Разберём ваш вопрос онлайн или в студии. Время подберёт менеджер.",
      ],
      [
        "Маман кеңесі, 1 сағат",
        "Сұрағыңызды онлайн немесе студияда талқылаймыз. Уақытты менеджер таңдайды.",
      ],
      [
        "Specialist consultation, 1 hour",
        "We will go through your question online or in the studio. The manager will pick the time.",
      ],
      [
        "Mutaxassis maslahati, 1 soat",
        "Savolingizni onlayn yoki studiyada ko‘rib chiqamiz. Vaqtni menejer tanlaydi.",
      ],
    ),
    P(
      0,
      "physical",
      5000,
      [
        "Товар из каталога",
        "Короткое описание: размер, материал, что входит. ИИ-консультант отвечает по этим данным.",
      ],
      [
        "Каталогтағы тауар",
        "Қысқаша сипаттама: өлшемі, материалы, не кіреді. ЖИ-кеңесші осы деректер бойынша жауап береді.",
      ],
      [
        "Catalogue item",
        "Short description: size, material, what is included. The AI consultant answers using this data.",
      ],
      [
        "Katalogdagi mahsulot",
        "Qisqa tavsif: o‘lchami, materiali, nimalar kiradi. AI-maslahatchi shu ma‘lumotlar asosida javob beradi.",
      ],
    ),
  ],
};

/**
 * Онлайн-школа: разделы каталога без примеров-файлов — главный пример здесь
 * курс с уроками и домашними заданиями (COURSE_EXAMPLE, модуль «Курсы»).
 */
const courses: NicheTemplate = {
  categories: [
    { ru: "Курсы", kk: "Курстар", en: "Courses", uz: "Kurslar" },
    { ru: "Мастер-классы", kk: "Шеберлік сабақтары", en: "Workshops", uz: "Master-klasslar" },
  ],
  products: [],
};

export const NICHE_TEMPLATES: Record<VerticalKey, NicheTemplate> = {
  digital,
  courses,
  confectionery,
  flowers,
  consultant,
  consultant_universal: universal,
};

/** Пометка примера в названии: по ней продавец и поиск видят, что это не настоящий товар. */
export const EXAMPLE_PREFIX: Record<Locale, string> = {
  ru: "Пример · ",
  kk: "Үлгі · ",
  en: "Example · ",
  uz: "Namuna · ",
};

/** Язык примеров: язык магазина; не задан — русский. */
export function templateLang(locale: Locale | undefined): Locale {
  return locale === "kk" || locale === "en" || locale === "uz" ? locale : "ru";
}

/** Онлайн-школа: пример курса с потоком и двумя тарифами (core/templates/apply). */
export const SCHOOL_EXAMPLE: { cohort: Text; selfPaced: Text; withReview: Text } = {
  cohort: { ru: "Первый поток", kk: "Бірінші ағын", en: "First cohort", uz: "Birinchi oqim" },
  selfPaced: { ru: "Самостоятельно", kk: "Өз бетінше", en: "Self-paced", uz: "Mustaqil" },
  withReview: {
    ru: "С проверкой ДЗ",
    kk: "ҮТ тексерумен",
    en: "With homework review",
    uz: "Uy vazifasi tekshiruvi bilan",
  },
};

export type CourseExample = {
  name: Text;
  description: Text;
  price: number;
  /** Уроки открываются по одному раз в столько дней после оплаты. */
  everyDays: number;
  lessons: Array<{ title: Text; text: Text; homework?: Text }>;
};

/**
 * Пример курса: добавляется шаблоном ниши, когда у магазина включены
 * «Курсы». Скрытый цифровой товар с уроками по расписанию: продавец меняет
 * тексты, добавляет видео или файлы к урокам и материал к товару, включает.
 */
export const COURSE_EXAMPLE: CourseExample = {
  name: {
    ru: "Мини-курс за 3 дня",
    kk: "3 күндік мини-курс",
    en: "3-day mini course",
    uz: "3 kunlik mini-kurs",
  },
  description: {
    ru: "Три урока, по одному в день после оплаты. Ссылка на курс придёт в бот вместе с материалами, о каждом новом уроке бот напомнит.",
    kk: "Үш сабақ, төлемнен кейін күніне біреуден. Курс сілтемесі материалдармен бірге ботқа келеді, әр жаңа сабақ туралы бот еске салады.",
    en: "Three lessons, one a day after payment. The course link arrives in the bot with the materials, and the bot reminds you about each new lesson.",
    uz: "Uchta dars, to‘lovdan keyin kuniga bittadan. Kurs havolasi materiallar bilan birga botga keladi, har bir yangi dars haqida bot eslatadi.",
  },
  price: 5000,
  everyDays: 1,
  lessons: [
    {
      title: {
        ru: "Урок 1. Знакомство",
        kk: "1-сабақ. Танысу",
        en: "Lesson 1. Introduction",
        uz: "1-dars. Tanishuv",
      },
      text: {
        ru: "Расскажите, что ученик получит за курс и как проходить уроки. Добавьте видео ссылкой или файлом.",
        kk: "Оқушы курстан не алатынын және сабақтарды қалай өтетінін айтыңыз. Бейнені сілтеме немесе файл ретінде қосыңыз.",
        en: "Tell students what they get from the course and how to take the lessons. Add a video as a link or a file.",
        uz: "O‘quvchi kursdan nima olishini va darslarni qanday o‘tishini ayting. Videoni havola yoki fayl sifatida qo‘shing.",
      },
    },
    {
      title: {
        ru: "Урок 2. Практика",
        kk: "2-сабақ. Тәжірибе",
        en: "Lesson 2. Practice",
        uz: "2-dars. Amaliyot",
      },
      text: {
        ru: "Главное задание курса: шаги, пример, частые ошибки.",
        kk: "Курстың негізгі тапсырмасы: қадамдар, мысал, жиі қателер.",
        en: "The main task of the course: steps, an example, common mistakes.",
        uz: "Kursning asosiy topshirig‘i: qadamlar, misol, tez-tez uchraydigan xatolar.",
      },
      homework: {
        ru: "Повторите пример из урока и пришлите фото результата. Преподаватель проверит и ответит.",
        kk: "Сабақтағы мысалды қайталап, нәтиженің фотосын жіберіңіз. Оқытушы тексеріп, жауап береді.",
        en: "Repeat the example from the lesson and send a photo of the result. The teacher will review it and reply.",
        uz: "Darsdagi misolni takrorlab, natijaning suratini yuboring. O‘qituvchi tekshirib, javob beradi.",
      },
    },
    {
      title: {
        ru: "Урок 3. Итоги",
        kk: "3-сабақ. Қорытынды",
        en: "Lesson 3. Summary",
        uz: "3-dars. Yakun",
      },
      text: {
        ru: "Что делать дальше и куда писать с вопросами. Здесь можно предложить следующий курс.",
        kk: "Әрі қарай не істеу керек және сұрақтарды қайда жазу керек. Мұнда келесі курсты ұсынуға болады.",
        en: "What to do next and where to send questions. This is a good place to offer the next course.",
        uz: "Keyin nima qilish kerakligi va savollarni qayerga yozish. Bu yerda keyingi kursni taklif qilish mumkin.",
      },
    },
  ],
};
