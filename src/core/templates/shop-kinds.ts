/**
 * Шаблоны магазина по типу (Р2): «цифровые материалы», «товары с доставкой»,
 * «услуги и курсы». В отличие от шаблонов ниши (niches.ts, скрытые примеры
 * товаров), здесь настоящие категории, тексты страницы «О магазине» и
 * настройки выдачи и оплаты. Тексты не обещают больше, чем делает код: то, что
 * написано про доставку и оплату, совпадает с тем, что включено в настройках.
 * Язык текстов — язык магазина (default_locale), не задан — русский.
 */
import type { Locale } from "@/core/i18n/locale";

type Text = Record<Locale, string>;

export const SHOP_KINDS = ["digital", "goods", "services"] as const;
export type ShopKind = (typeof SHOP_KINDS)[number];

export type ShopKindTemplate = {
  categories: Text[];
  about: { description: Text; delivery: Text; payment: Text };
  /** Ключи app_settings: выдача и оплата. */
  settings: { pickup: boolean; delivery: boolean; paymentMode: "full" };
};

const payFull: Text = {
  ru: "Оплата полностью при оформлении заказа.",
  kk: "Төлем тапсырыс рәсімдеу кезінде толық төленеді.",
  en: "Payment in full when you place the order.",
  uz: "To‘lov buyurtma berishda to‘liq amalga oshiriladi.",
};

export const SHOP_KIND_TEMPLATES: Record<ShopKind, ShopKindTemplate> = {
  digital: {
    categories: [
      { ru: "Шаблоны", kk: "Үлгілер", en: "Templates", uz: "Shablonlar" },
      {
        ru: "Чек-листы и гайды",
        kk: "Чек-парақтар мен нұсқаулықтар",
        en: "Checklists and guides",
        uz: "Chek-varaqlar va qo‘llanmalar",
      },
      { ru: "Наборы", kk: "Жиынтықтар", en: "Bundles", uz: "To‘plamlar" },
      { ru: "Бесплатное", kk: "Тегін", en: "Free", uz: "Bepul" },
    ],
    about: {
      description: {
        ru: "Цифровые материалы: после подтверждения оплаты файл приходит автоматически.",
        kk: "Цифрлық материалдар: төлем расталғаннан кейін файл автоматты түрде келеді.",
        en: "Digital materials: once your payment is confirmed, the file arrives automatically.",
        uz: "Raqamli materiallar: to‘lov tasdiqlangach fayl avtomatik keladi.",
      },
      delivery: {
        ru: "Доставка не нужна: материал приходит файлом или ссылкой после подтверждения оплаты.",
        kk: "Жеткізу қажет емес: материал төлем расталғаннан кейін файл немесе сілтеме түрінде келеді.",
        en: "No delivery needed: the material arrives as a file or a link once your payment is confirmed.",
        uz: "Yetkazib berish kerak emas: material to‘lov tasdiqlangach fayl yoki havola sifatida keladi.",
      },
      payment: payFull,
    },
    settings: { pickup: false, delivery: false, paymentMode: "full" },
  },
  goods: {
    categories: [
      { ru: "Хиты", kk: "Хиттер", en: "Bestsellers", uz: "Xitlar" },
      { ru: "Новинки", kk: "Жаңалықтар", en: "New arrivals", uz: "Yangiliklar" },
      { ru: "Подарки", kk: "Сыйлықтар", en: "Gifts", uz: "Sovg‘alar" },
      { ru: "Акции", kk: "Акциялар", en: "Sales", uz: "Aksiyalar" },
    ],
    about: {
      description: {
        ru: "Товары с самовывозом и доставкой: выбираете способ при оформлении заказа.",
        kk: "Өзі алып кету және жеткізу бар тауарлар: тәсілді тапсырыс рәсімдеу кезінде таңдайсыз.",
        en: "Products with pickup and delivery: you choose the method when you place the order.",
        uz: "O‘zi olib ketish va yetkazib berish bor mahsulotlar: usulni buyurtma berishda tanlaysiz.",
      },
      delivery: {
        ru: "Можно забрать самому или заказать доставку: способ выбирается при оформлении заказа.",
        kk: "Өзіңіз алып кетуге немесе жеткізуді тапсырыс беруге болады: тәсіл тапсырыс рәсімдеу кезінде таңдалады.",
        en: "Pick it up yourself or have it delivered: you choose the method when you place the order.",
        uz: "O‘zingiz olib ketishingiz yoki yetkazib berishni buyurtma qilishingiz mumkin: usul buyurtma berishda tanlanadi.",
      },
      payment: payFull,
    },
    settings: { pickup: true, delivery: true, paymentMode: "full" },
  },
  services: {
    categories: [
      { ru: "Консультации", kk: "Кеңестер", en: "Consultations", uz: "Maslahatlar" },
      { ru: "Занятия", kk: "Сабақтар", en: "Lessons", uz: "Mashg‘ulotlar" },
      { ru: "Курсы", kk: "Курстар", en: "Courses", uz: "Kurslar" },
      { ru: "Пакеты", kk: "Пакеттер", en: "Packages", uz: "Paketlar" },
    ],
    about: {
      description: {
        ru: "Услуги и курсы: выбираете услугу и оплачиваете онлайн, детали согласуем после оплаты.",
        kk: "Қызметтер мен курстар: қызметті таңдап, онлайн төлейсіз, егжей-тегжейін төлемнен кейін келісеміз.",
        en: "Services and courses: pick a service and pay online, we agree on the details after payment.",
        uz: "Xizmatlar va kurslar: xizmatni tanlab onlayn to‘laysiz, tafsilotlarni to‘lovdan keyin kelishamiz.",
      },
      delivery: {
        ru: "Услуги оказываются по договорённости, доставка не требуется.",
        kk: "Қызметтер келісім бойынша көрсетіледі, жеткізу қажет емес.",
        en: "Services are provided by arrangement, no delivery needed.",
        uz: "Xizmatlar kelishuv asosida ko‘rsatiladi, yetkazib berish kerak emas.",
      },
      payment: payFull,
    },
    settings: { pickup: false, delivery: false, paymentMode: "full" },
  },
};

export function isShopKind(v: unknown): v is ShopKind {
  return typeof v === "string" && (SHOP_KINDS as readonly string[]).includes(v);
}
