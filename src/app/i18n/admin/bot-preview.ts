import type { SectionDict } from "../section";

/** Раздел «Предпросмотр бота». */
export const ru = {
  "botPreview.title": "Предпросмотр бота",
  "botPreview.subtitle":
    "Так бот выглядит для покупателя в Telegram при текущих настройках и модулях. Ничего не отправляется.",
  "botPreview.language": "Язык покупателя",
  "botPreview.product": "Товар для карточки",
  "botPreview.search": "Найти товар по названию",
  "botPreview.searchEmpty": "Ничего не найдено.",
  "botPreview.noProducts": "В каталоге нет активных товаров, карточку показать не на чем.",
  "botPreview.start": "Покупатель нажимает «Старт»",
  "botPreview.chooseLanguage": "Покупатель выбирает язык",
  "botPreview.openProduct": "Покупатель открывает товар",
  "botPreview.menu": "Кнопки внизу экрана",
  "botPreview.photoAlt": "Фото товара",
  "botPreview.priceNote": "Цена показана для страны по умолчанию, с действующей акцией.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "botPreview.title": "Ботты алдын ала қарау",
  "botPreview.subtitle":
    "Қазіргі баптаулар мен модульдерде бот сатып алушыға Telegram-да осылай көрінеді. Ештеңе жіберілмейді.",
  "botPreview.language": "Сатып алушының тілі",
  "botPreview.product": "Карточкаға арналған тауар",
  "botPreview.search": "Тауарды атауы бойынша іздеу",
  "botPreview.searchEmpty": "Ештеңе табылмады.",
  "botPreview.noProducts": "Каталогта белсенді тауар жоқ, карточканы көрсетуге болмайды.",
  "botPreview.start": "Сатып алушы «Бастау» басады",
  "botPreview.chooseLanguage": "Сатып алушы тілді таңдайды",
  "botPreview.openProduct": "Сатып алушы тауарды ашады",
  "botPreview.menu": "Экранның төменгі түймелері",
  "botPreview.photoAlt": "Тауар фотосы",
  "botPreview.priceNote": "Баға әдепкі ел үшін, қолданыстағы акциямен көрсетілген.",
};

export const en: SectionDict<typeof ru> = {
  "botPreview.title": "Bot preview",
  "botPreview.subtitle":
    "This is how the bot looks to a customer in Telegram with the current settings and modules. Nothing is sent.",
  "botPreview.language": "Customer language",
  "botPreview.product": "Product for the card",
  "botPreview.search": "Find a product by name",
  "botPreview.searchEmpty": "Nothing found.",
  "botPreview.noProducts": "There are no active products in the catalog to show a card.",
  "botPreview.start": "The customer taps “Start”",
  "botPreview.chooseLanguage": "The customer picks a language",
  "botPreview.openProduct": "The customer opens a product",
  "botPreview.menu": "Buttons at the bottom of the screen",
  "botPreview.photoAlt": "Product photo",
  "botPreview.priceNote": "The price is shown for the default country, with any active offer.",
};

export const uz: SectionDict<typeof ru> = {
  "botPreview.title": "Botni oldindan ko‘rish",
  "botPreview.subtitle":
    "Joriy sozlamalar va modullarda bot xaridorga Telegram’da shunday ko‘rinadi. Hech narsa yuborilmaydi.",
  "botPreview.language": "Xaridor tili",
  "botPreview.product": "Kartochka uchun mahsulot",
  "botPreview.search": "Mahsulotni nomi bo‘yicha topish",
  "botPreview.searchEmpty": "Hech narsa topilmadi.",
  "botPreview.noProducts": "Katalogda faol mahsulot yo‘q, kartochkani ko‘rsatib bo‘lmaydi.",
  "botPreview.start": "Xaridor «Start»ni bosadi",
  "botPreview.chooseLanguage": "Xaridor tilni tanlaydi",
  "botPreview.openProduct": "Xaridor mahsulotni ochadi",
  "botPreview.menu": "Ekran pastidagi tugmalar",
  "botPreview.photoAlt": "Mahsulot rasmi",
  "botPreview.priceNote": "Narx standart mamlakat uchun, amaldagi aksiya bilan ko‘rsatilgan.",
};
