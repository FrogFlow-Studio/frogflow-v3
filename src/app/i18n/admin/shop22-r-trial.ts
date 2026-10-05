import type { SectionDict } from "../section";

/** Путь Р, Р4: «Пробный заказ» (core/orders/trial, app/admin/onboarding). */
export const ru = {
  "trial.button": "Пробный заказ",
  "trial.intro":
    "Проверим оформление на вашем товаре: цену, оплату, файл, выдачу и уведомления. Заказ, платёж и баллы при этом не создаются, в отчёты ничего не попадает.",
  "trial.running": "Проверяем…",
  "trial.noProduct": "Включённых товаров нет: добавьте и включите хотя бы один, затем повторите.",
  "trial.passed": "Пробный заказ прошёл: покупатель сможет оформить «{name}».",
  "trial.failed": "Пробный заказ не прошёл: исправьте пункты ниже.",
  "trial.sum": "Сумма {total}, к оплате сразу {due}.",
  "trial.issue.telegram": "Бот Telegram не подключён: покупателю негде оформить заказ.",
  "trial.issue.payment": "Нет способа оплаты: покупатель не увидит, куда платить.",
  "trial.issue.file": "У цифрового товара нет файла: оплатят и ничего не получат.",
  "trial.issue.price": "У товара нет цены.",
  "trial.issue.currency": "Цену товара не удалось посчитать (разные валюты).",
  "trial.issue.delivery": "Самовывоз и доставка выключены: физический товар не оформить.",
  "trial.issue.notify":
    "Некому слать уведомления о заказах: укажите получателя в настройках уведомлений.",
  "trial.notified.sent": "Пробное уведомление отправлено вам в Telegram.",
  "trial.notified.recent": "Пробное уведомление уже отправляли минуту назад, второе не шлём.",
  "trial.notified.none": "Пробное уведомление не отправлено: нет бота или получателя.",
  "trial.notified.failed": "Пробное уведомление не удалось отправить, повторно не отправляем.",
  "trial.notice":
    "🧪 <b>Пробный заказ</b>\n{name} — {total}\nЭто проверка: заказа и платежа нет. Так будут приходить уведомления о настоящих заказах.",
};

export const kk: SectionDict<typeof ru> = {
  "trial.button": "Сынақ тапсырыс",
  "trial.intro":
    "Тауарыңызда рәсімдеуді тексереміз: баға, төлем, файл, беру және хабарламалар. Бұл кезде тапсырыс, төлем және ұпай жасалмайды, есептерге ештеңе түспейді.",
  "trial.running": "Тексеріп жатырмыз…",
  "trial.noProduct": "Қосулы тауар жоқ: кемінде біреуін қосыңыз да, қайталаңыз.",
  "trial.passed": "Сынақ тапсырыс өтті: сатып алушы «{name}» тауарын рәсімдей алады.",
  "trial.failed": "Сынақ тапсырыс өтпеді: төмендегі тармақтарды түзетіңіз.",
  "trial.sum": "Сомасы {total}, бірден төленетіні {due}.",
  "trial.issue.telegram": "Telegram боты қосылмаған: сатып алушыға тапсырыс беретін орын жоқ.",
  "trial.issue.payment": "Төлем тәсілі жоқ: сатып алушы қайда төлеу керектігін көрмейді.",
  "trial.issue.file": "Цифрлық тауарда файл жоқ: төлейді де, ештеңе алмайды.",
  "trial.issue.price": "Тауардың бағасы жоқ.",
  "trial.issue.currency": "Тауар бағасын есептеу мүмкін болмады (валюталар әртүрлі).",
  "trial.issue.delivery":
    "Өзі алып кету және жеткізу өшірулі: физикалық тауарды рәсімдеу мүмкін емес.",
  "trial.issue.notify":
    "Тапсырыс туралы хабарлама жіберетін ешкім жоқ: хабарлама баптауларында алушыны көрсетіңіз.",
  "trial.notified.sent": "Сынақ хабарлама Telegram-ға жіберілді.",
  "trial.notified.recent": "Сынақ хабарлама бір минут бұрын жіберілген, екіншісін жібермейміз.",
  "trial.notified.none": "Сынақ хабарлама жіберілмеді: бот немесе алушы жоқ.",
  "trial.notified.failed": "Сынақ хабарламаны жіберу мүмкін болмады, қайта жібермейміз.",
  "trial.notice":
    "🧪 <b>Сынақ тапсырыс</b>\n{name} — {total}\nБұл тексеру: тапсырыс пен төлем жоқ. Нақты тапсырыстар туралы хабарламалар осылай келеді.",
};

export const en: SectionDict<typeof ru> = {
  "trial.button": "Trial order",
  "trial.intro":
    "We will check checkout on your product: price, payment, file, delivery and notifications. No order, payment or points are created and nothing reaches your reports.",
  "trial.running": "Checking…",
  "trial.noProduct": "There are no active products: add and enable at least one, then try again.",
  "trial.passed": "The trial order passed: a buyer can check out “{name}”.",
  "trial.failed": "The trial order failed: fix the items below.",
  "trial.sum": "Total {total}, due now {due}.",
  "trial.issue.telegram": "The Telegram bot is not connected: buyers have nowhere to order.",
  "trial.issue.payment": "There is no payment method: buyers will not see where to pay.",
  "trial.issue.file": "The digital product has no file: buyers would pay and get nothing.",
  "trial.issue.price": "The product has no price.",
  "trial.issue.currency": "The product price could not be calculated (mixed currencies).",
  "trial.issue.delivery": "Pickup and delivery are both off: a physical product cannot be ordered.",
  "trial.issue.notify":
    "Nobody receives order notifications: set a recipient in notification settings.",
  "trial.notified.sent": "A trial notification was sent to your Telegram.",
  "trial.notified.recent":
    "A trial notification was sent a minute ago, we will not send a second one.",
  "trial.notified.none": "No trial notification was sent: there is no bot or recipient.",
  "trial.notified.failed": "The trial notification could not be sent and will not be retried.",
  "trial.notice":
    "🧪 <b>Trial order</b>\n{name} — {total}\nThis is a check: there is no order or payment. Real order notifications will look like this.",
};

export const uz: SectionDict<typeof ru> = {
  "trial.button": "Sinov buyurtmasi",
  "trial.intro":
    "Mahsulotingizda rasmiylashtirishni tekshiramiz: narx, to‘lov, fayl, berish va xabarnomalar. Buyurtma, to‘lov va ballar yaratilmaydi, hisobotlarga hech narsa tushmaydi.",
  "trial.running": "Tekshirilmoqda…",
  "trial.noProduct":
    "Yoqilgan mahsulot yo‘q: kamida bittasini qo‘shib yoqing va qayta urinib ko‘ring.",
  "trial.passed": "Sinov buyurtmasi o‘tdi: xaridor «{name}» mahsulotini rasmiylashtira oladi.",
  "trial.failed": "Sinov buyurtmasi o‘tmadi: quyidagi bandlarni tuzating.",
  "trial.sum": "Summa {total}, darhol to‘lanadigani {due}.",
  "trial.issue.telegram": "Telegram boti ulanmagan: xaridorga buyurtma beradigan joy yo‘q.",
  "trial.issue.payment": "To‘lov usuli yo‘q: xaridor qayerga to‘lashni ko‘rmaydi.",
  "trial.issue.file": "Raqamli mahsulotda fayl yo‘q: to‘laydi-yu, hech narsa olmaydi.",
  "trial.issue.price": "Mahsulotning narxi yo‘q.",
  "trial.issue.currency": "Mahsulot narxini hisoblab bo‘lmadi (valyutalar har xil).",
  "trial.issue.delivery":
    "O‘zi olib ketish va yetkazib berish o‘chirilgan: jismoniy mahsulotni rasmiylashtirib bo‘lmaydi.",
  "trial.issue.notify":
    "Buyurtma xabarnomalarini oladigan hech kim yo‘q: xabarnoma sozlamalarida oluvchini ko‘rsating.",
  "trial.notified.sent": "Sinov xabarnomasi Telegram’ingizga yuborildi.",
  "trial.notified.recent":
    "Sinov xabarnomasi bir daqiqa oldin yuborilgan, ikkinchisini yubormaymiz.",
  "trial.notified.none": "Sinov xabarnomasi yuborilmadi: bot yoki oluvchi yo‘q.",
  "trial.notified.failed": "Sinov xabarnomasini yuborib bo‘lmadi, qayta yubormaymiz.",
  "trial.notice":
    "🧪 <b>Sinov buyurtmasi</b>\n{name} — {total}\nBu tekshiruv: buyurtma va to‘lov yo‘q. Haqiqiy buyurtmalar haqidagi xabarnomalar shunday keladi.",
};
