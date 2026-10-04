import type { SectionDict } from "../section";

/** Страница «О магазине» (В4): настройки. */
export const ru = {
  "settings.about.title": "О магазине (страница на витрине)",
  "settings.about.intro":
    "Эту информацию покупатели увидят на странице «О магазине» вашей витрины: описание, контакты, часы, условия доставки и оплаты, а также свежие одобренные отзывы. Пока ничего не заполнено, страницы нет. Поисковики получают разметку организации по тем данным, что вы указали.",
  "settings.about.description": "Описание магазина",
  "settings.about.phone": "Телефон",
  "settings.about.address": "Адрес",
  "settings.about.hours": "Часы работы (например, Пн–Сб 10:00–19:00)",
  "settings.about.delivery": "Доставка",
  "settings.about.payment": "Оплата",
  "settings.about.ownerOnly": "Страницу меняет владелец магазина.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "settings.about.title": "Дүкен туралы (витринадағы бет)",
  "settings.about.intro":
    "Бұл ақпаратты сатып алушылар витринаның «Дүкен туралы» бетінде көреді: сипаттама, байланыс, жұмыс уақыты, жеткізу және төлем шарттары, сондай-ақ жаңа мақұлданған пікірлер. Ештеңе толтырылмаса, бет жоқ. Іздеу жүйелері ұйым белгілемесін сіз көрсеткен деректер бойынша алады.",
  "settings.about.description": "Дүкен сипаттамасы",
  "settings.about.phone": "Телефон",
  "settings.about.address": "Мекенжай",
  "settings.about.hours": "Жұмыс уақыты (мысалы, Дс–Сб 10:00–19:00)",
  "settings.about.delivery": "Жеткізу",
  "settings.about.payment": "Төлем",
  "settings.about.ownerOnly": "Бетті дүкен иесі өзгертеді.",
};

export const en: SectionDict<typeof ru> = {
  "settings.about.title": "About the shop (storefront page)",
  "settings.about.intro":
    "Buyers see this on your storefront’s “About the shop” page: description, contacts, hours, delivery and payment terms, plus fresh approved reviews. While nothing is filled in, there is no page. Search engines get organisation markup from what you enter.",
  "settings.about.description": "Shop description",
  "settings.about.phone": "Phone",
  "settings.about.address": "Address",
  "settings.about.hours": "Opening hours (e.g. Mon–Sat 10:00–19:00)",
  "settings.about.delivery": "Delivery",
  "settings.about.payment": "Payment",
  "settings.about.ownerOnly": "Only the shop owner can change the page.",
};

export const uz: SectionDict<typeof ru> = {
  "settings.about.title": "Do‘kon haqida (vitrinadagi sahifa)",
  "settings.about.intro":
    "Xaridorlar buni vitrinangizning «Do‘kon haqida» sahifasida ko‘radi: tavsif, aloqa, ish vaqti, yetkazib berish va to‘lov shartlari hamda yangi tasdiqlangan fikrlar. Hech narsa to‘ldirilmasa, sahifa yo‘q. Qidiruv tizimlari tashkilot belgilarini siz kiritgan ma’lumotlardan oladi.",
  "settings.about.description": "Do‘kon tavsifi",
  "settings.about.phone": "Telefon",
  "settings.about.address": "Manzil",
  "settings.about.hours": "Ish vaqti (masalan, Du–Sh 10:00–19:00)",
  "settings.about.delivery": "Yetkazib berish",
  "settings.about.payment": "To‘lov",
  "settings.about.ownerOnly": "Sahifani do‘kon egasi o‘zgartiradi.",
};
