import type { SectionDict } from "../section";

/** Запуск магазина на главной (А11): процент готовности, доставка, тексты бота, скрытие шагов. */
export const ru = {
  "launch.title": "Запуск магазина",
  "launch.percent": "готово на {n}%",
  "launch.skip": "Скрыть",
  "launch.restore": "Вернуть",
  "launch.skipped": "Скрытые шаги",
  "launch.products": "Добавить 5 товаров",
  "launch.productsHint":
    "Сейчас товаров: {n} из 5. Название, цена, фото; для цифровых материалов файл.",
  "launch.delivery": "Выбрать самовывоз и доставку",
  "launch.deliveryHint":
    "Откройте карточку «Физические товары: получение и оплата» в настройках и сохраните выбор, даже если подходит вариант по умолчанию.",
  "launch.botTexts": "Написать приветствие магазина",
  "launch.botTextsHint":
    "Строка под названием магазина: её видят покупатели в боте и на витрине. Она в разделе «Магазин» настроек.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "launch.title": "Дүкенді іске қосу",
  "launch.percent": "{n}% дайын",
  "launch.skip": "Жасыру",
  "launch.restore": "Қайтару",
  "launch.skipped": "Жасырылған қадамдар",
  "launch.products": "5 тауар қосу",
  "launch.productsHint":
    "Қазір тауар: 5-тен {n}. Атауы, бағасы, фотосы; цифрлық материалдарға файл.",
  "launch.delivery": "Өзі алып кету мен жеткізуді таңдау",
  "launch.deliveryHint":
    "Баптаулардағы «Физикалық тауарлар: алу және төлем» карточкасын ашып, әдепкі нұсқа сәйкес келсе де таңдауды сақтаңыз.",
  "launch.botTexts": "Дүкеннің сәлемдесу жолын жазу",
  "launch.botTextsHint":
    "Дүкен атауының астындағы жол: оны сатып алушылар ботта және витринада көреді. Ол баптаулардағы «Дүкен» бөлімінде.",
};

export const en: SectionDict<typeof ru> = {
  "launch.title": "Shop launch",
  "launch.percent": "{n}% ready",
  "launch.skip": "Hide",
  "launch.restore": "Restore",
  "launch.skipped": "Hidden steps",
  "launch.products": "Add 5 products",
  "launch.productsHint": "Products now: {n} of 5. Name, price, photo; a file for digital products.",
  "launch.delivery": "Choose pickup and delivery",
  "launch.deliveryHint":
    "Open the “Physical goods: fulfilment and payment” card in settings and save your choice, even if the default suits you.",
  "launch.botTexts": "Write the shop greeting",
  "launch.botTextsHint":
    "The line under the shop name: buyers see it in the bot and on the storefront. It is in the “Shop” section of settings.",
};

export const uz: SectionDict<typeof ru> = {
  "launch.title": "Do‘konni ishga tushirish",
  "launch.percent": "{n}% tayyor",
  "launch.skip": "Yashirish",
  "launch.restore": "Qaytarish",
  "launch.skipped": "Yashirilgan qadamlar",
  "launch.products": "5 ta tovar qo‘shish",
  "launch.productsHint":
    "Hozir tovarlar: 5 tadan {n} ta. Nomi, narxi, rasmi; raqamli materiallar uchun fayl.",
  "launch.delivery": "Olib ketish va yetkazib berishni tanlash",
  "launch.deliveryHint":
    "Sozlamalardagi «Jismoniy mahsulotlar: olish va to‘lov» kartasini oching va standart variant mos bo‘lsa ham tanlovni saqlang.",
  "launch.botTexts": "Do‘kon salomlashuv qatorini yozish",
  "launch.botTextsHint":
    "Do‘kon nomi ostidagi qator: xaridorlar uni botda va vitrinada ko‘radi. U sozlamalardagi «Do‘kon» bo‘limida.",
};
