import type { SectionDict } from "../section";

/** Ошибки и сообщения сервера для продавца (UserError и ответы действий): errors-admin. */
export const ru = {
  // права и модули (app/auth/guards.server)
  "err.auth.ownerOnly": "Это может изменить только владелец магазина.",
  "err.auth.viewOnly": "У вашей роли нет прав на изменения — только просмотр.",
  "err.auth.moduleOff": "Модуль «{module}» не подключён к вашему тарифу.",
  // вход
  "err.login.tooMany": "Слишком много неудачных попыток. Попробуйте через 15 минут.",
  "err.login.oldPlatform":
    "Ваш магазин пока работает на прежней платформе FrogFlow — войдите в прежнюю панель. Переезд на новую включает оператор.",
  // команда магазина
  "err.admin.loginFormat": "Логин: латиница, цифры, точка, дефис и «_», от 3 до 40 символов.",
  "err.admin.loginIsOwner": "Это логин владельца магазина.",
  "err.admin.loginTaken": "Логин «{login}» уже занят.",
  "err.admin.passwordRequired": "Для нового пользователя нужен пароль.",
  "err.admin.passwordShort": "Пароль — не короче 8 символов.",
  "err.admin.teamLimit": "Не больше 20 пользователей у магазина.",
  // товары, заказы, настройки
  "err.admin.digitalNeedsFile":
    "Цифровому товару нужен хотя бы один файл — иначе покупатель заплатит и ничего не получит.",
  "err.admin.orderNotFound": "Заказ не найден",
  "err.admin.unknownTimezone": "Неизвестный часовой пояс",
  "err.admin.channelOff": "Этот канал не подключён к вашему тарифу — оставьте заявку в «Модулях».",
  "err.admin.noAnthropicKey": "На платформе не задан ключ Anthropic.",
  // скидки
  "err.admin.percentMax": "Процент не больше 100.",
  "err.admin.codeTaken": "Такой код уже есть.",
  "err.admin.codeGenFailed": "Не удалось подобрать уникальный код",
  "err.template.notEmpty":
    "Примеры добавляются только в пустой магазин — у вас уже есть товары или категории.",
  "err.upload.tooBig": "Файл больше {mb} МБ.",
  "err.upload.badType": "Этот тип файла не поддерживается.",
  "err.upload.empty": "Файл пустой.",
  "err.upload.notStored": "Файл не дошёл до хранилища. Попробуйте ещё раз.",
  // рассылки WhatsApp
  "err.admin.waPickTemplate": "Выберите аккаунт и шаблон WhatsApp.",
  "err.admin.waNotYours": "Этот аккаунт WhatsApp не подключён к вашему магазину.",
  "err.admin.waTemplateMissing": "Шаблон не найден — обновите список шаблонов.",
  "err.admin.waTemplateNotApproved":
    "Шаблон ещё не одобрен Meta (статус {status}) — отправлять нельзя.",
  "err.admin.waTemplateParams": "Шаблон ждёт {count} подстановок — заполните все.",
  "err.admin.waSyncFailed": "Не удалось обновить шаблоны",
  "err.admin.waRejected": "Meta не приняла шаблон",
  // чат с покупателем
  "err.admin.noZernioDialog": "У покупателя нет диалога в Zernio — ответить некуда",
  "err.admin.inboxAssignee": "Такого пользователя нет в команде магазина.",
  "err.admin.sendFailed": "Не удалось отправить сообщение",
  "err.admin.sendTelegramFailed": "Не удалось отправить сообщение в Telegram",
  // CRM, Instagram, акции, возвратные продажи
  "err.admin.crmUrl": "Адрес должен начинаться с https:// и вести на внешний сервер.",
  "err.admin.crmSaveFirst": "Сначала сохраните адрес вебхука.",
  "err.admin.igPostNotFound": "Zernio не нашёл публикацию по ссылке — проверьте ссылку и аккаунт.",
  "err.admin.offerEnd": "Окончание акции должно быть позже начала.",
  "err.admin.winbackOrder": "Второе сообщение должно идти позже первого.",
  "err.admin.winbackPromo":
    "Промокод {code} не найден или не действует — заведите его в «Скидках».",
  // действия с заказом (admin.server runOrderAction)
  "msg.orders.rejected": "Заказ #{no} отклонён",
  "msg.orders.alreadyClosed": "Заказ #{no} уже закрыт ({status})",
  "msg.orders.accepted": "Заказ #{no} принят",
  "msg.orders.acceptedPaid": "Заказ #{no} принят, записана оплата {sum}",
  "msg.orders.cannotAccept": "Заказ #{no} нельзя принять из статуса «{status}»",
  "msg.orders.noDialog": "У покупателя из {platform} нет диалога для выдачи",
  "msg.orders.alreadyDelivered": "Заказ #{no} уже выдан",
  "msg.orders.langAsked":
    "Заказ #{no}: покупателю задан вопрос о языке ({count} поз.) — файлы уйдут после ответа",
  "msg.orders.delivered": "Заказ #{no} выдан: {count} поз.",
  "msg.orders.partial": "Выдано {sent}, не удалось {failed}. Проверьте файлы товаров и повторите.",
  "msg.orders.noTransition": "Из этого статуса перехода нет",
  "msg.orders.status": "Статус: {status}",
  "msg.orders.statusChanged": "Статус уже изменился",
  "msg.orders.remindOnlyAwaiting": "Напоминание только для заказов, ждущих оплаты",
  "msg.orders.reminded": "Напоминание отправлено",
  "msg.orders.remindFailed": "Не удалось отправить",
} as const;

export const kk: SectionDict<typeof ru> = {
  "err.auth.ownerOnly": "Мұны тек дүкен иесі өзгерте алады.",
  "err.auth.viewOnly": "Сіздің рөліңізге өзгерту құқығы берілмеген — тек қарау.",
  "err.auth.moduleOff": "«{module}» модулі тарифіңізге қосылмаған.",
  "err.login.tooMany": "Сәтсіз әрекеттер тым көп. 15 минуттан кейін қайталап көріңіз.",
  "err.login.oldPlatform":
    "Дүкеніңіз әзірге FrogFlow-тың бұрынғы платформасында жұмыс істейді — бұрынғы панельге кіріңіз. Жаңа платформаға көшіруді оператор қосады.",
  "err.admin.loginFormat":
    "Логин: латын әріптері, цифрлар, нүкте, дефис және «_», 3-тен 40 таңбаға дейін.",
  "err.admin.loginIsOwner": "Бұл — дүкен иесінің логині.",
  "err.admin.loginTaken": "«{login}» логині бос емес.",
  "err.admin.passwordRequired": "Жаңа пайдаланушыға құпиясөз қажет.",
  "err.admin.passwordShort": "Құпиясөз кемінде 8 таңбадан тұруы керек.",
  "err.admin.teamLimit": "Бір дүкенде 20-дан артық пайдаланушы болмайды.",
  "err.admin.digitalNeedsFile":
    "Цифрлық тауарға кемінде бір файл қажет — әйтпесе сатып алушы төлейді де, ештеңе алмайды.",
  "err.admin.orderNotFound": "Тапсырыс табылмады",
  "err.admin.unknownTimezone": "Белгісіз уақыт белдеуі",
  "err.admin.channelOff":
    "Бұл арна тарифіңізге қосылмаған — «Модульдер» бөлімінде өтінім қалдырыңыз.",
  "err.admin.noAnthropicKey": "Платформада Anthropic кілті орнатылмаған.",
  "err.admin.percentMax": "Пайыз 100-ден аспауы керек.",
  "err.admin.codeTaken": "Мұндай код бұрыннан бар.",
  "err.admin.codeGenFailed": "Бірегей код құрастыру мүмкін болмады",
  "err.template.notEmpty": "Үлгілер тек бос дүкенге қосылады — сізде тауарлар немесе санаттар бар.",
  "err.upload.tooBig": "Файл {mb} МБ-тан үлкен.",
  "err.upload.badType": "Бұл файл түріне қолдау көрсетілмейді.",
  "err.upload.empty": "Файл бос.",
  "err.upload.notStored": "Файл қоймаға жетпеді. Қайта көріңіз.",
  "err.admin.waPickTemplate": "WhatsApp аккаунты мен шаблонын таңдаңыз.",
  "err.admin.waNotYours": "Бұл WhatsApp аккаунты дүкеніңізге қосылмаған.",
  "err.admin.waTemplateMissing": "Шаблон табылмады — шаблондар тізімін жаңартыңыз.",
  "err.admin.waTemplateNotApproved":
    "Шаблонды Meta әлі мақұлдаған жоқ (мәртебесі {status}) — жіберуге болмайды.",
  "err.admin.waTemplateParams": "Шаблонға {count} мән қажет — барлығын толтырыңыз.",
  "err.admin.waSyncFailed": "Шаблондарды жаңарту мүмкін болмады",
  "err.admin.waRejected": "Meta шаблонды қабылдамады",
  "err.admin.noZernioDialog": "Сатып алушының Zernio-да диалогы жоқ — жауап жіберетін жер жоқ",
  "err.admin.inboxAssignee": "Мұндай пайдаланушы дүкен командасында жоқ.",
  "err.admin.sendFailed": "Хабарламаны жіберу мүмкін болмады",
  "err.admin.sendTelegramFailed": "Хабарламаны Telegram-ға жіберу мүмкін болмады",
  "err.admin.crmUrl": "Мекенжай https:// деп басталып, сыртқы серверге апаруы керек.",
  "err.admin.crmSaveFirst": "Алдымен вебхук мекенжайын сақтаңыз.",
  "err.admin.igPostNotFound":
    "Zernio сілтеме бойынша жарияланымды таппады — сілтеме мен аккаунтты тексеріңіз.",
  "err.admin.offerEnd": "Акция басталғаннан кейін аяқталуы керек.",
  "err.admin.winbackOrder": "Екінші хабарлама біріншісінен кейін жіберілуі керек.",
  "err.admin.winbackPromo":
    "{code} промокоды табылмады немесе жарамсыз — оны «Жеңілдіктер» бөлімінде жасаңыз.",
  "msg.orders.rejected": "#{no} тапсырыс қабылданбады",
  "msg.orders.alreadyClosed": "#{no} тапсырыс жабылып қойған ({status})",
  "msg.orders.accepted": "#{no} тапсырыс қабылданды",
  "msg.orders.acceptedPaid": "#{no} тапсырыс қабылданды, {sum} төлем жазылды",
  "msg.orders.cannotAccept": "#{no} тапсырысты «{status}» мәртебесінен қабылдауға болмайды",
  "msg.orders.noDialog": "{platform} арқылы келген сатып алушымен беру үшін диалог жоқ",
  "msg.orders.alreadyDelivered": "#{no} тапсырыс бұрын берілген",
  "msg.orders.langAsked":
    "#{no} тапсырыс: сатып алушыдан тіл сұралды ({count} поз.) — файлдар жауаптан кейін жіберіледі",
  "msg.orders.delivered": "#{no} тапсырыс берілді: {count} поз.",
  "msg.orders.partial":
    "Берілді: {sent}, берілмеді: {failed}. Тауар файлдарын тексеріп, қайталаңыз.",
  "msg.orders.noTransition": "Бұл мәртебеден өту жоқ",
  "msg.orders.status": "Мәртебе: {status}",
  "msg.orders.statusChanged": "Мәртебе әлдеқашан өзгерген",
  "msg.orders.remindOnlyAwaiting": "Еске салу тек төлем күтіп тұрған тапсырыстарға жіберіледі",
  "msg.orders.reminded": "Еске салу жіберілді",
  "msg.orders.remindFailed": "Жіберу мүмкін болмады",
};

export const en: SectionDict<typeof ru> = {
  "err.auth.ownerOnly": "Only the shop owner can change this.",
  "err.auth.viewOnly": "Your role cannot make changes — view only.",
  "err.auth.moduleOff": "The “{module}” module is not included in your plan.",
  "err.login.tooMany": "Too many failed attempts. Please try again in 15 minutes.",
  "err.login.oldPlatform":
    "Your shop still runs on the previous FrogFlow platform — sign in to the old panel. The move to the new one is enabled by the operator.",
  "err.admin.loginFormat":
    "Login: Latin letters, digits, dot, hyphen and “_”, from 3 to 40 characters.",
  "err.admin.loginIsOwner": "This is the shop owner's login.",
  "err.admin.loginTaken": "The login “{login}” is already taken.",
  "err.admin.passwordRequired": "A new user needs a password.",
  "err.admin.passwordShort": "The password must be at least 8 characters.",
  "err.admin.teamLimit": "A shop can have no more than 20 users.",
  "err.admin.digitalNeedsFile":
    "A digital product needs at least one file — otherwise the buyer pays and gets nothing.",
  "err.admin.orderNotFound": "Order not found",
  "err.admin.unknownTimezone": "Unknown time zone",
  "err.admin.channelOff":
    "This channel is not included in your plan — send a request in “Modules”.",
  "err.admin.noAnthropicKey": "No Anthropic key is set on the platform.",
  "err.admin.percentMax": "The percentage cannot exceed 100.",
  "err.admin.codeTaken": "This code already exists.",
  "err.admin.codeGenFailed": "Could not generate a unique code",
  "err.template.notEmpty":
    "Examples can only be added to an empty shop: you already have products or categories.",
  "err.upload.tooBig": "The file is larger than {mb} MB.",
  "err.upload.badType": "This file type is not supported.",
  "err.upload.empty": "The file is empty.",
  "err.upload.notStored": "The file did not reach storage. Please try again.",
  "err.admin.waPickTemplate": "Choose a WhatsApp account and template.",
  "err.admin.waNotYours": "This WhatsApp account is not connected to your shop.",
  "err.admin.waTemplateMissing": "Template not found — refresh the template list.",
  "err.admin.waTemplateNotApproved":
    "The template has not been approved by Meta yet (status {status}) — it cannot be sent.",
  "err.admin.waTemplateParams": "The template expects {count} values — fill them all in.",
  "err.admin.waSyncFailed": "Could not refresh the templates",
  "err.admin.waRejected": "Meta did not accept the template",
  "err.admin.noZernioDialog": "The buyer has no Zernio conversation — there is nowhere to reply",
  "err.admin.inboxAssignee": "There is no such user in the shop team.",
  "err.admin.sendFailed": "Could not send the message",
  "err.admin.sendTelegramFailed": "Could not send the message to Telegram",
  "err.admin.crmUrl": "The address must start with https:// and point to an external server.",
  "err.admin.crmSaveFirst": "Save the webhook address first.",
  "err.admin.igPostNotFound":
    "Zernio could not find a post at this link — check the link and the account.",
  "err.admin.offerEnd": "The offer must end after it starts.",
  "err.admin.winbackOrder": "The second message must be sent later than the first.",
  "err.admin.winbackPromo":
    "Promo code {code} was not found or is not active — create it in “Discounts”.",
  "msg.orders.rejected": "Order #{no} rejected",
  "msg.orders.alreadyClosed": "Order #{no} is already closed ({status})",
  "msg.orders.accepted": "Order #{no} accepted",
  "msg.orders.acceptedPaid": "Order #{no} accepted, payment of {sum} recorded",
  "msg.orders.cannotAccept": "Order #{no} cannot be accepted from the status “{status}”",
  "msg.orders.noDialog": "The buyer from {platform} has no conversation to deliver to",
  "msg.orders.alreadyDelivered": "Order #{no} has already been delivered",
  "msg.orders.langAsked":
    "Order #{no}: the buyer was asked to choose a language ({count} items) — the files will be sent after they reply",
  "msg.orders.delivered": "Order #{no} delivered: {count} items",
  "msg.orders.partial": "Delivered {sent}, failed {failed}. Check the product files and try again.",
  "msg.orders.noTransition": "The status cannot be changed this way",
  "msg.orders.status": "Status: {status}",
  "msg.orders.statusChanged": "The status has already changed",
  "msg.orders.remindOnlyAwaiting": "Reminders are only for orders awaiting payment",
  "msg.orders.reminded": "Reminder sent",
  "msg.orders.remindFailed": "Could not send",
};

export const uz: SectionDict<typeof ru> = {
  "err.auth.ownerOnly": "Buni faqat doʻkon egasi oʻzgartira oladi.",
  "err.auth.viewOnly": "Sizning rolingizda oʻzgartirish huquqi yoʻq — faqat koʻrish.",
  "err.auth.moduleOff": "«{module}» moduli tarifingizga ulanmagan.",
  "err.login.tooMany":
    "Muvaffaqiyatsiz urinishlar juda koʻp. 15 daqiqadan keyin qayta urinib koʻring.",
  "err.login.oldPlatform":
    "Doʻkoningiz hozircha FrogFlowning avvalgi platformasida ishlaydi — avvalgi panelga kiring. Yangi platformaga oʻtishni operator yoqadi.",
  "err.admin.loginFormat":
    "Login: lotin harflari, raqamlar, nuqta, defis va «_», 3 tadan 40 tagacha belgi.",
  "err.admin.loginIsOwner": "Bu doʻkon egasining logini.",
  "err.admin.loginTaken": "«{login}» logini band.",
  "err.admin.passwordRequired": "Yangi foydalanuvchi uchun parol kerak.",
  "err.admin.passwordShort": "Parol kamida 8 ta belgidan iborat boʻlishi kerak.",
  "err.admin.teamLimit": "Bitta doʻkonda 20 tadan ortiq foydalanuvchi boʻlmaydi.",
  "err.admin.digitalNeedsFile":
    "Raqamli mahsulotga kamida bitta fayl kerak — aks holda xaridor pul toʻlaydi-yu, hech narsa olmaydi.",
  "err.admin.orderNotFound": "Buyurtma topilmadi",
  "err.admin.unknownTimezone": "Nomaʼlum vaqt mintaqasi",
  "err.admin.channelOff":
    "Bu kanal tarifingizga ulanmagan — «Modullar» boʻlimida soʻrov qoldiring.",
  "err.admin.noAnthropicKey": "Platformada Anthropic kaliti koʻrsatilmagan.",
  "err.admin.percentMax": "Foiz 100 dan oshmasligi kerak.",
  "err.admin.codeTaken": "Bunday kod allaqachon mavjud.",
  "err.admin.codeGenFailed": "Takrorlanmas kod tanlab boʻlmadi",
  "err.template.notEmpty":
    "Namunalar faqat boʻsh do‘konga qo‘shiladi: sizda mahsulot yoki toifalar bor.",
  "err.upload.tooBig": "Fayl {mb} MB dan katta.",
  "err.upload.badType": "Bu fayl turi qoʻllab-quvvatlanmaydi.",
  "err.upload.empty": "Fayl boʻsh.",
  "err.upload.notStored": "Fayl omborga yetib bormadi. Qayta urinib koʻring.",
  "err.admin.waPickTemplate": "WhatsApp akkaunti va shablonini tanlang.",
  "err.admin.waNotYours": "Bu WhatsApp akkaunti doʻkoningizga ulanmagan.",
  "err.admin.waTemplateMissing": "Shablon topilmadi — shablonlar roʻyxatini yangilang.",
  "err.admin.waTemplateNotApproved":
    "Shablon hali Meta tomonidan tasdiqlanmagan (holati {status}) — yuborib boʻlmaydi.",
  "err.admin.waTemplateParams": "Shablon {count} ta qiymat kutmoqda — hammasini toʻldiring.",
  "err.admin.waSyncFailed": "Shablonlarni yangilab boʻlmadi",
  "err.admin.waRejected": "Meta shablonni qabul qilmadi",
  "err.admin.noZernioDialog": "Xaridorning Zernioda suhbati yoʻq — javob yuboradigan joy yoʻq",
  "err.admin.inboxAssignee": "Do‘kon jamoasida bunday foydalanuvchi yo‘q.",
  "err.admin.sendFailed": "Xabarni yuborib boʻlmadi",
  "err.admin.sendTelegramFailed": "Xabarni Telegramga yuborib boʻlmadi",
  "err.admin.crmUrl": "Manzil https:// bilan boshlanishi va tashqi serverga olib borishi kerak.",
  "err.admin.crmSaveFirst": "Avval webhook manzilini saqlang.",
  "err.admin.igPostNotFound":
    "Zernio havola boʻyicha postni topmadi — havola va akkauntni tekshiring.",
  "err.admin.offerEnd": "Aksiya boshlanganidan keyin tugashi kerak.",
  "err.admin.winbackOrder": "Ikkinchi xabar birinchisidan keyin yuborilishi kerak.",
  "err.admin.winbackPromo":
    "{code} promokodi topilmadi yoki amal qilmaydi — uni «Chegirmalar» boʻlimida yarating.",
  "msg.orders.rejected": "#{no} buyurtma rad etildi",
  "msg.orders.alreadyClosed": "#{no} buyurtma allaqachon yopilgan ({status})",
  "msg.orders.accepted": "#{no} buyurtma qabul qilindi",
  "msg.orders.acceptedPaid": "#{no} buyurtma qabul qilindi, {sum} toʻlov yozildi",
  "msg.orders.cannotAccept": "#{no} buyurtmani «{status}» holatidan qabul qilib boʻlmaydi",
  "msg.orders.noDialog": "{platform} orqali kelgan xaridor bilan topshirish uchun suhbat yoʻq",
  "msg.orders.alreadyDelivered": "#{no} buyurtma allaqachon topshirilgan",
  "msg.orders.langAsked":
    "#{no} buyurtma: xaridordan til soʻraldi ({count} ta pozitsiya) — fayllar javobdan keyin yuboriladi",
  "msg.orders.delivered": "#{no} buyurtma topshirildi: {count} ta pozitsiya",
  "msg.orders.partial":
    "Topshirildi: {sent}, topshirib boʻlmadi: {failed}. Mahsulot fayllarini tekshirib, qayta urinib koʻring.",
  "msg.orders.noTransition": "Bu holatdan oʻtish yoʻq",
  "msg.orders.status": "Holat: {status}",
  "msg.orders.statusChanged": "Holat allaqachon oʻzgargan",
  "msg.orders.remindOnlyAwaiting": "Eslatma faqat toʻlov kutayotgan buyurtmalar uchun",
  "msg.orders.reminded": "Eslatma yuborildi",
  "msg.orders.remindFailed": "Yuborib boʻlmadi",
};
