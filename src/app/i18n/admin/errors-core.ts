import type { SectionDict } from "../section";

/** Ошибки и сообщения сервера для продавца (UserError и ответы действий): errors-core. */
export const ru = {
  "err.orders.notFound": "Заказ не найден",
  "err.customer.badBirthday": "Не разобрал дату — например 15.03",
  "err.orders.amountPositive": "Сумма должна быть больше нуля",
  "err.orders.rejectedNoPayment": "Заказ отклонён — оплата по нему не принимается",
  "err.orders.manualPaymentPhysicalOnly":
    "Ручное внесение оплаты доступно только для физических заказов",
  "err.orders.amountOverRemaining": "Сумма больше остатка: осталось внести {remaining}",
  "err.orders.noBalanceProof": "Чека на остаток, который ждёт проверки, нет",
  "err.orders.paymentNotSaved": "Не удалось записать платёж, попробуйте ещё раз",
  "err.settings.saveFailed":
    "Настройка не сохранилась. Попробуйте ещё раз; если повторится — напишите в поддержку.",
  "err.settings.tooLong":
    "Текст в поле «{field}» слишком длинный: {length} символов, допустимо не больше {max}.",
  "err.orders.zoneNotFound": "Зона доставки не найдена",
  "err.orders.noItems": "Добавьте хотя бы одну позицию",
  "err.orders.deliveryZoneRequired": "Для доставки выберите зону",
  "err.orders.productUnavailable": "Товар не найден или скрыт",
  "err.orders.digitalProduct":
    "«{name}» — цифровой товар; вручную заводятся только физические заказы",
  "err.orders.variantRequired": "Выберите вариант для «{name}»",
  "err.orders.variantNotFound": "Вариант не найден для «{name}»",
  "err.orders.noVariants": "У «{name}» нет вариантов",
  "err.orders.mixedCurrency": "Все позиции должны быть в одной валюте",
  "err.orders.dateTooEarly":
    "Слишком ранняя дата получения — срок изготовления {days} дн., доступно с {date}",
  "err.orders.datePassed": "Дата получения уже прошла — доступно с {date}",
  "err.orders.zoneCurrency": "Зона доставки в {zoneCurrency}, а товары в {currency}",
  "err.orders.paidNegative": "Внесённая сумма не может быть отрицательной",
  "err.orders.paidOverTotal": "Внесено больше итога заказа ({total})",
  "err.orders.outOfStock": "Недостаточно «{name}» на складе",
  "err.orders.createFailed": "Не удалось создать заказ",
  "err.orders.fulfillmentPhysicalOnly": "Способ получения правится только у физического заказа",
  "err.orders.closed": "Заказ уже закрыт",
  "err.orders.pickZone": "Выберите зону доставки",
  "err.orders.feeBelowPaid":
    "Нельзя снять комиссию доставки — заказ уже оплачен на большую сумму. Сначала верните разницу покупателю.",
  "err.orders.cannotDeliver": "Заказ #{no} нельзя выдать (статус: {status})",
  "err.catalog.selfParent": "Категория не может быть родителем самой себе.",
  "err.catalog.hasProducts": "В категории {count} товаров — сначала перенесите их.",
  "err.catalog.hasSubcategories": "У категории есть подкатегории — сначала удалите их.",
  "err.instagram.dmRequired":
    "Текст сообщения в Direct обязателен — без него автоматизации нечего отправить.",
  "err.instagram.dmTooLong":
    "Сообщение в Direct — {length} символов, предел {limit}. Сократите текст.",
  "err.instagram.variantTooLong":
    "Один из вариантов текста длиннее {limit} символов. Сократите его.",
  "err.stories.idRequired": "Укажите ссылку на сторис или её id.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "err.orders.notFound": "Тапсырыс табылмады",
  "err.customer.badBirthday": "Күнді түсінбедім — мысалы 15.03",
  "err.orders.amountPositive": "Сома нөлден үлкен болуы керек",
  "err.orders.rejectedNoPayment": "Тапсырыс қабылданбаған — ол бойынша төлем алынбайды",
  "err.orders.manualPaymentPhysicalOnly":
    "Төлемді қолмен енгізу тек физикалық тапсырыстарға қолжетімді",
  "err.orders.amountOverRemaining": "Сома қалдықтан көп: енгізуге {remaining} қалды",
  "err.orders.noBalanceProof": "Тексерісті күтіп тұрған қалған сома чегі жоқ",
  "err.orders.paymentNotSaved": "Төлем жазылмады, қайталап көріңіз",
  "err.settings.saveFailed":
    "Баптау сақталмады. Қайта көріңіз; қайталанса — қолдау қызметіне жазыңыз.",
  "err.settings.tooLong":
    "«{field}» өрісіндегі мәтін тым ұзын: {length} таңба, ең көбі {max} рұқсат етіледі.",
  "err.orders.zoneNotFound": "Жеткізу аймағы табылмады",
  "err.orders.noItems": "Кемінде бір позиция қосыңыз",
  "err.orders.deliveryZoneRequired": "Жеткізу үшін аймақты таңдаңыз",
  "err.orders.productUnavailable": "Тауар табылмады немесе жасырылған",
  "err.orders.digitalProduct":
    "«{name}» — цифрлық тауар; қолмен тек физикалық тапсырыстар енгізіледі",
  "err.orders.variantRequired": "«{name}» үшін нұсқаны таңдаңыз",
  "err.orders.variantNotFound": "«{name}» үшін нұсқа табылмады",
  "err.orders.noVariants": "«{name}» тауарының нұсқалары жоқ",
  "err.orders.mixedCurrency": "Барлық позиция бір валютада болуы керек",
  "err.orders.dateTooEarly":
    "Алу күні тым ерте — дайындау мерзімі {days} күн, {date} бастап қолжетімді",
  "err.orders.datePassed": "Алу күні өтіп кетті — {date} бастап қолжетімді",
  "err.orders.zoneCurrency":
    "Жеткізу аймағы {zoneCurrency} валютасында, ал тауарлар {currency} валютасында",
  "err.orders.paidNegative": "Енгізілген сома теріс бола алмайды",
  "err.orders.paidOverTotal": "Тапсырыс сомасынан ({total}) көп енгізілді",
  "err.orders.outOfStock": "Қоймада «{name}» жеткіліксіз",
  "err.orders.createFailed": "Тапсырыс жасалмады",
  "err.orders.fulfillmentPhysicalOnly": "Алу тәсілін тек физикалық тапсырыста өзгертуге болады",
  "err.orders.closed": "Тапсырыс жабылған",
  "err.orders.pickZone": "Жеткізу аймағын таңдаңыз",
  "err.orders.feeBelowPaid":
    "Жеткізу ақысын алып тастау мүмкін емес — тапсырыс үлкенірек сомаға төленген. Алдымен айырманы сатып алушыға қайтарыңыз.",
  "err.orders.cannotDeliver": "#{no} тапсырысты беру мүмкін емес (мәртебесі: {status})",
  "err.catalog.selfParent": "Санат өзіне-өзі ата санат бола алмайды.",
  "err.catalog.hasProducts":
    "Санатта {count} тауар бар — алдымен оларды басқа санатқа ауыстырыңыз.",
  "err.catalog.hasSubcategories": "Санаттың ішкі санаттары бар — алдымен оларды жойыңыз.",
  "err.instagram.dmRequired":
    "Direct хабарламасының мәтіні міндетті — онсыз автоматтандыруға жіберетін ештеңе жоқ.",
  "err.instagram.dmTooLong":
    "Direct хабарламасы — {length} таңба, шегі {limit}. Мәтінді қысқартыңыз.",
  "err.instagram.variantTooLong": "Мәтін нұсқаларының бірі {limit} таңбадан ұзын. Оны қысқартыңыз.",
  "err.stories.idRequired": "Сторис сілтемесін немесе оның id-ін көрсетіңіз.",
};

export const en: SectionDict<typeof ru> = {
  "err.orders.notFound": "Order not found",
  "err.customer.badBirthday": "Could not read the date — e.g. 15.03",
  "err.orders.amountPositive": "The amount must be greater than zero",
  "err.orders.rejectedNoPayment": "The order was rejected — payments for it are not accepted",
  "err.orders.manualPaymentPhysicalOnly": "Manual payments are only available for physical orders",
  "err.orders.amountOverRemaining": "The amount exceeds the balance: {remaining} left to pay",
  "err.orders.noBalanceProof": "There is no balance receipt waiting for review",
  "err.orders.paymentNotSaved": "Couldn't record the payment, please try again",
  "err.settings.saveFailed":
    "The setting was not saved. Please try again; if it happens again, contact support.",
  "err.settings.tooLong":
    "The text in field “{field}” is too long: {length} characters, the limit is {max}.",
  "err.orders.zoneNotFound": "Delivery zone not found",
  "err.orders.noItems": "Add at least one item",
  "err.orders.deliveryZoneRequired": "Choose a zone for delivery",
  "err.orders.productUnavailable": "Product not found or hidden",
  "err.orders.digitalProduct":
    "“{name}” is a digital product; only physical orders can be created manually",
  "err.orders.variantRequired": "Choose a variant for “{name}”",
  "err.orders.variantNotFound": "Variant not found for “{name}”",
  "err.orders.noVariants": "“{name}” has no variants",
  "err.orders.mixedCurrency": "All items must be in the same currency",
  "err.orders.dateTooEarly":
    "The pickup date is too early — preparation takes {days} days, available from {date}",
  "err.orders.datePassed": "The pickup date has already passed — available from {date}",
  "err.orders.zoneCurrency":
    "The delivery zone is in {zoneCurrency}, but the products are in {currency}",
  "err.orders.paidNegative": "The amount paid can't be negative",
  "err.orders.paidOverTotal": "The amount paid is more than the order total ({total})",
  "err.orders.outOfStock": "Not enough “{name}” in stock",
  "err.orders.createFailed": "Couldn't create the order",
  "err.orders.fulfillmentPhysicalOnly":
    "The fulfillment method can only be changed for a physical order",
  "err.orders.closed": "The order is already closed",
  "err.orders.pickZone": "Choose a delivery zone",
  "err.orders.feeBelowPaid":
    "Can't remove the delivery fee — the order has already been paid for a larger amount. Refund the difference to the customer first.",
  "err.orders.cannotDeliver": "Order #{no} can't be handed over (status: {status})",
  "err.catalog.selfParent": "A category can't be its own parent.",
  "err.catalog.hasProducts": "The category has {count} products — move them first.",
  "err.catalog.hasSubcategories": "The category has subcategories — delete them first.",
  "err.instagram.dmRequired":
    "The Direct message text is required — without it the automation has nothing to send.",
  "err.instagram.dmTooLong":
    "The Direct message is {length} characters, the limit is {limit}. Shorten the text.",
  "err.instagram.variantTooLong":
    "One of the text variations is longer than {limit} characters. Shorten it.",
  "err.stories.idRequired": "Enter the story link or its id.",
};

export const uz: SectionDict<typeof ru> = {
  "err.orders.notFound": "Buyurtma topilmadi",
  "err.customer.badBirthday": "Sanani tushunmadim — masalan 15.03",
  "err.orders.amountPositive": "Summa noldan katta boʻlishi kerak",
  "err.orders.rejectedNoPayment": "Buyurtma rad etilgan — u boʻyicha toʻlov qabul qilinmaydi",
  "err.orders.manualPaymentPhysicalOnly":
    "Toʻlovni qoʻlda kiritish faqat jismoniy buyurtmalar uchun mavjud",
  "err.orders.amountOverRemaining": "Summa qoldiqdan katta: {remaining} toʻlash qoldi",
  "err.orders.noBalanceProof": "Tekshiruvni kutayotgan qolgan summa cheki yoʻq",
  "err.orders.paymentNotSaved": "Toʻlovni yozib boʻlmadi, qayta urinib koʻring",
  "err.settings.saveFailed":
    "Sozlama saqlanmadi. Qayta urinib koʻring; takrorlansa — qoʻllab-quvvatlash xizmatiga yozing.",
  "err.settings.tooLong":
    "«{field}» maydonidagi matn juda uzun: {length} belgi, ruxsat etilgani {max} tadan oshmasligi kerak.",
  "err.orders.zoneNotFound": "Yetkazib berish hududi topilmadi",
  "err.orders.noItems": "Kamida bitta pozitsiya qoʻshing",
  "err.orders.deliveryZoneRequired": "Yetkazib berish uchun hududni tanlang",
  "err.orders.productUnavailable": "Mahsulot topilmadi yoki yashirilgan",
  "err.orders.digitalProduct":
    "«{name}» — raqamli mahsulot; qoʻlda faqat jismoniy buyurtmalar kiritiladi",
  "err.orders.variantRequired": "«{name}» uchun variantni tanlang",
  "err.orders.variantNotFound": "«{name}» uchun variant topilmadi",
  "err.orders.noVariants": "«{name}» mahsulotining variantlari yoʻq",
  "err.orders.mixedCurrency": "Barcha pozitsiyalar bitta valyutada boʻlishi kerak",
  "err.orders.dateTooEarly":
    "Olish sanasi juda erta — tayyorlash muddati {days} kun, {date} dan boshlab mavjud",
  "err.orders.datePassed": "Olish sanasi oʻtib ketgan — {date} dan boshlab mavjud",
  "err.orders.zoneCurrency":
    "Yetkazib berish hududi {zoneCurrency} da, mahsulotlar esa {currency} da",
  "err.orders.paidNegative": "Kiritilgan summa manfiy boʻlishi mumkin emas",
  "err.orders.paidOverTotal": "Buyurtma jami summasidan ({total}) koʻp kiritildi",
  "err.orders.outOfStock": "Omborda «{name}» yetarli emas",
  "err.orders.createFailed": "Buyurtmani yaratib boʻlmadi",
  "err.orders.fulfillmentPhysicalOnly":
    "Olish usulini faqat jismoniy buyurtmada oʻzgartirish mumkin",
  "err.orders.closed": "Buyurtma allaqachon yopilgan",
  "err.orders.pickZone": "Yetkazib berish hududini tanlang",
  "err.orders.feeBelowPaid":
    "Yetkazib berish haqini olib tashlab boʻlmaydi — buyurtma kattaroq summaga toʻlangan. Avval farqni xaridorga qaytaring.",
  "err.orders.cannotDeliver": "#{no} buyurtmani topshirib boʻlmaydi (holati: {status})",
  "err.catalog.selfParent": "Kategoriya oʻziga oʻzi ota kategoriya boʻla olmaydi.",
  "err.catalog.hasProducts": "Kategoriyada {count} ta mahsulot bor — avval ularni koʻchiring.",
  "err.catalog.hasSubcategories":
    "Kategoriyaning ichki kategoriyalari bor — avval ularni oʻchiring.",
  "err.instagram.dmRequired":
    "Direct xabari matni majburiy — usiz avtomatlashtirish hech narsa yubora olmaydi.",
  "err.instagram.dmTooLong":
    "Direct xabari — {length} belgi, chegara {limit}. Matnni qisqartiring.",
  "err.instagram.variantTooLong":
    "Matn variantlaridan biri {limit} belgidan uzun. Uni qisqartiring.",
  "err.stories.idRequired": "Stories havolasini yoki uning id raqamini kiriting.",
};
