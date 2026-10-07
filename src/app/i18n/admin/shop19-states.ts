import type { SectionDict } from "../section";

/** Единые «пусто» и «не удалось загрузить» в списках админки (А7). */
export const ru = {
  "orders.emptyTitle": "Заказов пока нет",
  "orders.emptyHint":
    "Они появятся здесь, когда покупатель оформит покупку в боте или на витрине. Проверьте путь покупателя сами.",
  "customers.emptyTitle": "Покупателей пока нет",
  "customers.emptyHint":
    "Покупатель появляется после первого сообщения боту или заказа на витрине.",
  "customers.emptyHintChat":
    "Покупатель появляется после первого сообщения боту, в Instagram или WhatsApp.",
  "states.addProducts": "Добавить товары",
  "categories.emptyTitle": "Категорий пока нет",
  "categories.emptyHint":
    "Категории группируют товары в каталоге. Товары без категории показываются на первом экране.",
  "products.emptyHint":
    "Добавьте первый товар: название, цена и фото. Остальное можно настроить позже.",
  "states.loadFailed": "Не удалось загрузить данные.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "orders.emptyTitle": "Тапсырыс әлі жоқ",
  "orders.emptyHint":
    "Сатып алушы ботта немесе витринада сатып алғанда, олар осында пайда болады. Сатып алу жолын өзіңіз тексеріңіз.",
  "customers.emptyTitle": "Сатып алушылар әлі жоқ",
  "customers.emptyHint":
    "Сатып алушы ботқа алғашқы хабарлама жазғаннан немесе витринада тапсырыс бергеннен кейін пайда болады.",
  "customers.emptyHintChat":
    "Сатып алушы ботқа, Instagram немесе WhatsApp-қа алғашқы хабарлама жазғаннан кейін пайда болады.",
  "states.addProducts": "Тауар қосу",
  "categories.emptyTitle": "Санаттар әлі жоқ",
  "categories.emptyHint":
    "Санаттар тауарларды каталогта топтайды. Санатсыз тауарлар бірінші экранда көрсетіледі.",
  "products.emptyHint":
    "Алғашқы тауарды қосыңыз: атауы, бағасы және фото. Қалғанын кейін бапталады.",
  "states.loadFailed": "Деректерді жүктеу мүмкін болмады.",
};

export const en: SectionDict<typeof ru> = {
  "orders.emptyTitle": "No orders yet",
  "orders.emptyHint":
    "They will appear here when a buyer places an order in the bot or on the storefront. Try the buyer path yourself.",
  "customers.emptyTitle": "No buyers yet",
  "customers.emptyHint":
    "A buyer appears after their first message to the bot or an order on the storefront.",
  "customers.emptyHintChat":
    "A buyer appears after their first message to the bot, on Instagram or on WhatsApp.",
  "states.addProducts": "Add products",
  "categories.emptyTitle": "No categories yet",
  "categories.emptyHint":
    "Categories group products in the catalog. Products without a category are shown on the first screen.",
  "products.emptyHint":
    "Add your first product: name, price and photo. The rest can be set up later.",
  "states.loadFailed": "Could not load the data.",
};

export const uz: SectionDict<typeof ru> = {
  "orders.emptyTitle": "Buyurtmalar hozircha yoʻq",
  "orders.emptyHint":
    "Xaridor botda yoki vitrinada buyurtma bergach, ular shu yerda paydo boʻladi. Xaridor yoʻlini oʻzingiz sinab koʻring.",
  "customers.emptyTitle": "Xaridorlar hozircha yoʻq",
  "customers.emptyHint":
    "Xaridor botga birinchi xabar yozgach yoki vitrinada buyurtma bergach paydo boʻladi.",
  "customers.emptyHintChat":
    "Xaridor botga, Instagram yoki WhatsAppʼga birinchi xabar yozgach paydo boʻladi.",
  "states.addProducts": "Mahsulot qoʻshish",
  "categories.emptyTitle": "Kategoriyalar hozircha yoʻq",
  "categories.emptyHint":
    "Kategoriyalar katalogdagi mahsulotlarni guruhlaydi. Kategoriyasiz mahsulotlar birinchi ekranda koʻrsatiladi.",
  "products.emptyHint":
    "Birinchi mahsulotni qoʻshing: nomi, narxi va foto. Qolganini keyin sozlash mumkin.",
  "states.loadFailed": "Maʼlumotlarni yuklab boʻlmadi.",
};
