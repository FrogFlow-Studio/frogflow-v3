import type { Locale } from "@/core/i18n/locale";

/**
 * Правила площадки (/market/rules) на 4 языках. Текст описывает только то, что код
 * действительно делает: согласие магазина, одобрение и скрытие оператором, что показывается.
 * Юридические формулировки (оферта) здесь не меняются. Русский — источник ключей.
 */
const ru = {
  "meta.title": "Правила площадки FrogFlow",
  "meta.description":
    "Как работает площадка FrogFlow: участие по согласию, одобрение и скрытие магазинов, что показывается покупателям.",
  title: "Правила площадки FrogFlow",
  lead: "Площадка — общий каталог магазинов FrogFlow. Здесь коротко описано, как она работает на самом деле.",
  "s1.title": "Участие добровольно",
  "s1.text":
    "Магазин попадает в каталог, только если его владелец сам включил «Показывать на площадке FrogFlow» в настройках. Выключить можно в любой момент: магазин перестаёт показываться в каталоге.",
  "s2.title": "Одобрение оператором",
  "s2.text":
    "Включённый магазин появляется в каталоге не сразу, а после одобрения оператором FrogFlow. До одобрения его в каталоге нет.",
  "s3.title": "Скрытие магазина",
  "s3.text":
    "Оператор может скрыть магазин с площадки. Скрытый магазин не показывается, даже если владелец оставил участие включённым; причину, если оператор её указал, владелец видит в настройках. Сама витрина магазина при этом продолжает работать.",
  "s4.title": "Что показывается",
  "s4.text":
    "Название магазина, категория, город, оценка и ссылка на витрину. Оценка считается только по одобренным отзывам. Заказы, суммы и данные покупателей на площадку не попадают.",
  "s5.title": "Заказ и оплата",
  "s5.text":
    "Заказ оформляется и оплачивается на витрине самого магазина, по его правилам и его оферте. Площадка не принимает заказы и не проводит платежи. Эти правила не заменяют оферту магазина.",
  "s6.title": "Если что-то не так",
  "s6.text":
    "По товару или заказу напишите магазину: на витрине есть «Написать магазину». Если магазин или товар нарушает правила, нажмите «Пожаловаться» в карточке магазина в каталоге или «Пожаловаться на товар» на странице товара: жалобу видит оператор FrogFlow, магазин её не видит. На один магазин или товар с одного адреса и устройства принимается одна жалоба в сутки. Можно также написать в поддержку FrogFlow, контакты на главной странице.",
  "s7.title": "Как рассматривается жалоба",
  "s7.text":
    "Причины жалобы: мошенничество или обман, заказ оплачен, но не получен, запрещённый товар или услуга, чужие материалы без разрешения, другое. Жалобу читает оператор FrogFlow и решает сам: скрыть магазин с площадки или отклонить жалобу. Ответ жалобщику не отправляется: контакты в форме не запрашиваются. С одного адреса принимается не более 5 жалоб в сутки. Жалоба не возвращает деньги и не отменяет заказ: площадка не принимает платежи, вопросы оплаты и доставки решайте с магазином. Скрытие с площадки не закрывает витрину магазина.",
  "link.market": "К каталогу магазинов",
  "link.home": "На главную",
} as const;

type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  "meta.title": "FrogFlow алаңының ережелері",
  "meta.description":
    "FrogFlow алаңы қалай жұмыс істейді: келісім бойынша қатысу, дүкендерді мақұлдау және жасыру, сатып алушыларға не көрсетіледі.",
  title: "FrogFlow алаңының ережелері",
  lead: "Алаң — FrogFlow дүкендерінің ортақ каталогы. Мұнда оның шын мәнінде қалай жұмыс істейтіні қысқаша жазылған.",
  "s1.title": "Қатысу ерікті",
  "s1.text":
    "Дүкен каталогқа иесі баптауларда «FrogFlow алаңында көрсету» опциясын өзі қосқанда ғана түседі. Оны кез келген уақытта өшіруге болады: дүкен каталогта көрсетілмейді.",
  "s2.title": "Оператордың мақұлдауы",
  "s2.text":
    "Қосылған дүкен каталогта бірден шықпайды, FrogFlow операторы мақұлдағаннан кейін шығады. Мақұлданғанға дейін оны каталогта көру мүмкін емес.",
  "s3.title": "Дүкенді жасыру",
  "s3.text":
    "Оператор дүкенді алаңнан жасыра алады. Жасырылған дүкен, иесі қатысуды қосулы қалдырса да, көрсетілмейді; себебін, оператор көрсетсе, иесі баптауларда көреді. Дүкеннің витринасы бұл кезде жұмысын жалғастырады.",
  "s4.title": "Не көрсетіледі",
  "s4.text":
    "Дүкеннің атауы, санаты, қаласы, рейтингі және витринаға сілтеме. Рейтинг тек мақұлданған пікірлер бойынша есептеледі. Тапсырыстар, сомалар және сатып алушылардың деректері алаңға түспейді.",
  "s5.title": "Тапсырыс және төлем",
  "s5.text":
    "Тапсырыс дүкеннің өз витринасында, оның ережелері мен офертасы бойынша рәсімделеді және төленеді. Алаң тапсырыс қабылдамайды және төлем жүргізбейді. Бұл ережелер дүкен офертасын алмастырмайды.",
  "s6.title": "Бірдеңе дұрыс болмаса",
  "s6.text":
    "Тауар немесе тапсырыс бойынша дүкенге жазыңыз: витринада «Дүкенге жазу» бар. Дүкен немесе тауар ережелерді бұзса, каталогтағы дүкен карточкасында «Шағымдану» немесе тауар бетінде «Тауар туралы шағымдану» батырмасын басыңыз: шағымды FrogFlow операторы көреді, дүкен көрмейді. Бір дүкенге немесе тауарға бір мекенжайдан және құрылғыдан тәулігіне бір шағым қабылданады. FrogFlow қолдауына да жазуға болады, байланыстар басты бетте.",
  "s7.title": "Шағым қалай қаралады",
  "s7.text":
    "Шағым себептері: алаяқтық немесе алдау, тапсырыс төленген, бірақ алынбаған, тыйым салынған тауар немесе қызмет, рұқсатсыз пайдаланылған басқа біреудің материалдары, басқа. Шағымды FrogFlow операторы оқып, өзі шешеді: дүкенді алаңнан жасыру немесе шағымды қабылдамау. Шағым берушіге жауап жіберілмейді: пішінде байланыс деректері сұралмайды. Бір мекенжайдан тәулігіне 5 шағымнан артық қабылданбайды. Шағым ақшаны қайтармайды және тапсырысты тоқтатпайды: алаң төлем қабылдамайды, төлем мен жеткізу мәселелерін дүкенмен шешіңіз. Алаңнан жасыру дүкен витринасын жаппайды.",
  "link.market": "Дүкендер каталогына",
  "link.home": "Басты бетке",
};

const en: Record<Key, string> = {
  "meta.title": "FrogFlow marketplace rules",
  "meta.description":
    "How the FrogFlow marketplace works: opt-in participation, operator approval and hiding of shops, and what buyers see.",
  title: "FrogFlow marketplace rules",
  lead: "The marketplace is a shared catalogue of FrogFlow shops. This page briefly describes how it actually works.",
  "s1.title": "Taking part is voluntary",
  "s1.text":
    "A shop appears in the catalogue only if its owner has switched on “Show on the FrogFlow marketplace” in settings. It can be switched off at any time: the shop stops being shown in the catalogue.",
  "s2.title": "Operator approval",
  "s2.text":
    "A shop that has opted in does not appear at once: it appears after a FrogFlow operator approves it. Until then it is not in the catalogue.",
  "s3.title": "Hiding a shop",
  "s3.text":
    "The operator can hide a shop from the marketplace. A hidden shop is not shown even if its owner left participation on; the owner sees the reason, if the operator gave one, in settings. The shop’s own storefront keeps working.",
  "s4.title": "What is shown",
  "s4.text":
    "The shop name, category, city, rating and a link to the storefront. The rating counts approved reviews only. Orders, amounts and buyer data never reach the marketplace.",
  "s5.title": "Orders and payment",
  "s5.text":
    "An order is placed and paid on the shop’s own storefront, under its rules and its offer. The marketplace does not take orders or process payments. These rules do not replace the shop’s offer.",
  "s6.title": "If something is wrong",
  "s6.text":
    "For a product or an order, write to the shop: the storefront has “Message the shop”. If a shop or a product breaks the rules, press “Report” on the shop card in the catalogue or “Report this product” on the product page: the FrogFlow operator sees the report, the shop does not. One report per shop or product from one address and device is accepted per day. You can also write to FrogFlow support; the contacts are on the home page.",
  "s7.title": "How a report is handled",
  "s7.text":
    "Reasons for a report: fraud or deception, paid but did not receive the order, a prohibited product or service, someone else’s materials without permission, other. A FrogFlow operator reads the report and decides: hide the shop from the marketplace or dismiss the report. No reply is sent to the person who reported: the form asks for no contact details. No more than 5 reports a day are accepted from one address. A report does not refund money or cancel an order: the marketplace does not take payments, so settle payment and delivery questions with the shop. Hiding a shop from the marketplace does not close its storefront.",
  "link.market": "Back to the shop catalogue",
  "link.home": "Home",
};

const uz: Record<Key, string> = {
  "meta.title": "FrogFlow maydoni qoidalari",
  "meta.description":
    "FrogFlow maydoni qanday ishlaydi: roziligi bilan ishtirok, do‘konlarni tasdiqlash va yashirish, xaridorlarga nima ko‘rsatiladi.",
  title: "FrogFlow maydoni qoidalari",
  lead: "Maydon — FrogFlow do‘konlarining umumiy katalogi. Bu yerda u aslida qanday ishlashi qisqacha yozilgan.",
  "s1.title": "Ishtirok ixtiyoriy",
  "s1.text":
    "Do‘kon katalogga faqat egasi sozlamalarda «FrogFlow maydonida ko‘rsatish»ni o‘zi yoqqanda tushadi. Uni istalgan vaqtda o‘chirish mumkin: do‘kon katalogda ko‘rsatilmay qoladi.",
  "s2.title": "Operator tasdig‘i",
  "s2.text":
    "Yoqilgan do‘kon katalogda darrov chiqmaydi, FrogFlow operatori tasdiqlagandan keyin chiqadi. Tasdiqlanguncha uni katalogda ko‘rib bo‘lmaydi.",
  "s3.title": "Do‘konni yashirish",
  "s3.text":
    "Operator do‘konni maydondan yashirishi mumkin. Yashirilgan do‘kon, egasi ishtirokni yoqilgan qoldirgan bo‘lsa ham, ko‘rsatilmaydi; sababini, operator ko‘rsatgan bo‘lsa, egasi sozlamalarda ko‘radi. Do‘konning vitrinasi bu vaqtda ishlashda davom etadi.",
  "s4.title": "Nima ko‘rsatiladi",
  "s4.text":
    "Do‘kon nomi, toifasi, shahri, bahosi va vitrinaga havola. Baho faqat tasdiqlangan sharhlar bo‘yicha hisoblanadi. Buyurtmalar, summalar va xaridorlar ma’lumotlari maydonga tushmaydi.",
  "s5.title": "Buyurtma va to‘lov",
  "s5.text":
    "Buyurtma do‘konning o‘z vitrinasida, uning qoidalari va ofertasi bo‘yicha rasmiylashtiriladi va to‘lanadi. Maydon buyurtma qabul qilmaydi va to‘lovlarni o‘tkazmaydi. Bu qoidalar do‘kon ofertasini almashtirmaydi.",
  "s6.title": "Biror narsa noto‘g‘ri bo‘lsa",
  "s6.text":
    "Mahsulot yoki buyurtma bo‘yicha do‘konga yozing: vitrinada «Do‘konga yozish» bor. Do‘kon yoki mahsulot qoidalarni buzsa, katalogdagi do‘kon kartochkasida «Shikoyat qilish» yoki mahsulot sahifasida «Mahsulot ustidan shikoyat qilish» tugmasini bosing: shikoyatni FrogFlow operatori ko‘radi, do‘kon ko‘rmaydi. Bitta do‘kon yoki mahsulotga bitta manzil va qurilmadan sutkada bitta shikoyat qabul qilinadi. FrogFlow yordamiga ham yozish mumkin, aloqa ma’lumotlari bosh sahifada.",
  "s7.title": "Shikoyat qanday ko‘rib chiqiladi",
  "s7.text":
    "Shikoyat sabablari: firibgarlik yoki aldov, buyurtma uchun to‘langan, lekin olinmagan, taqiqlangan mahsulot yoki xizmat, ruxsatsiz birovning materiallari, boshqa. Shikoyatni FrogFlow operatori o‘qiydi va o‘zi hal qiladi: do‘konni maydondan yashirish yoki shikoyatni rad etish. Shikoyat qiluvchiga javob yuborilmaydi: shaklda aloqa ma’lumotlari so‘ralmaydi. Bitta manzildan sutkada 5 tadan ortiq shikoyat qabul qilinmaydi. Shikoyat pulni qaytarmaydi va buyurtmani bekor qilmaydi: maydon to‘lovlarni qabul qilmaydi, to‘lov va yetkazib berish masalalarini do‘kon bilan hal qiling. Maydondan yashirish do‘kon vitrinasini yopmaydi.",
  "link.market": "Do‘konlar katalogiga",
  "link.home": "Bosh sahifaga",
};

const DICTS: Record<Locale, Record<Key, string>> = { ru, kk, en, uz };

export const RULES_KEYS = Object.keys(ru) as Key[];
export const RULES_SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;

export function rulesT(locale: Locale) {
  const d = DICTS[locale] ?? ru;
  return (key: Key) => d[key] ?? ru[key];
}
