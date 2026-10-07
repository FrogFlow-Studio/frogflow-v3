import type { SectionDict } from "../section";

/** Запуск магазина на главной (А11): процент готовности, доставка, тексты бота, скрытие шагов. */
export const ru = {
  "launch.titleConsultant": "Запуск консультанта",
  "launch.introConsultant":
    "Шаги, после которых консультант отвечает покупателям и передаёт вам заявки.",
  "launch.notificationsConsultant": "Куда присылать заявки",
  "launch.notificationsConsultantHint":
    "Ваш Telegram-id в настройках уведомлений: бот пришлёт каждую заявку, которую консультант передаёт вам. Свой id бот скажет по команде /id.",
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
  "launch.titleConsultant": "Кеңесшіні іске қосу",
  "launch.introConsultant":
    "Осы қадамдардан кейін кеңесші сатып алушыларға жауап беріп, өтінімдерді сізге жібереді.",
  "launch.notificationsConsultant": "Өтінімдерді қайда жіберу",
  "launch.notificationsConsultantHint":
    "Хабарландыру баптауларындағы Telegram-id: кеңесші сізге берген әр өтінімді бот жібереді. Өз id-іңізді бот /id командасымен айтады.",
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
  "launch.titleConsultant": "Consultant launch",
  "launch.introConsultant":
    "Steps after which the consultant answers buyers and passes requests to you.",
  "launch.notificationsConsultant": "Where to send requests",
  "launch.notificationsConsultantHint":
    "Your Telegram id in the notification settings: the bot sends every request the consultant passes to you. The bot tells you your id with the /id command.",
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
  "launch.titleConsultant": "Maslahatchini ishga tushirish",
  "launch.introConsultant":
    "Bu qadamlardan keyin maslahatchi xaridorlarga javob beradi va soʻrovlarni sizga yuboradi.",
  "launch.notificationsConsultant": "Soʻrovlarni qayerga yuborish",
  "launch.notificationsConsultantHint":
    "Bildirishnoma sozlamalaridagi Telegram-id: maslahatchi sizga uzatgan har bir soʻrovni bot yuboradi. Oʻz id raqamingizni bot /id buyrugʻi bilan aytadi.",
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
