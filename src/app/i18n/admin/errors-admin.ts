import type { SectionDict } from "../section";

/** Ошибки и сообщения сервера для продавца (UserError и ответы действий): errors-admin. */
export const ru = {
  // права и модули (app/auth/guards.server)
  "err.auth.ownerOnly": "Это может изменить только владелец магазина.",
  "err.auth.viewOnly": "У вашей роли нет прав на изменения — только просмотр.",
  "err.auth.accountantDenied": "Бухгалтеру этот раздел недоступен.",
  "err.auth.moduleOff": "Модуль «{module}» не подключён к вашему тарифу.",
  "err.homework.emptyRevise":
    "Напишите, что исправить: без комментария ученик не поймёт, что не так.",
  "err.homework.stale": "Ученик прислал новую версию, пока вы смотрели прежнюю. Обновите страницу.",
  "err.homework.notWaiting": "Эта работа уже проверена.",
  "err.curators.duplicate": "У двух кураторов один и тот же Telegram: уберите повтор.",
  "err.pricelist.off": "Консультант по прайсу у магазина не включён — его включает оператор.",
  "err.pricelist.empty":
    "В файле не нашлось ни одной позиции. Нужна выгрузка 1С в CSV: название, раздел, размер, цена.",
  "err.pricelist.badUrl": "Адрес сайта должен начинаться с https://",
  "err.pricelist.badRate": "Курс рубля к тенге — число от 1 до 20, например 4,79.",
  "err.pricelist.badFile": "Файл не найден — загрузите его ещё раз.",
  "err.pricelist.noMatch": "Укажите модель, как в прайсе: например «Uchino Zero Twist».",
  "err.pipeline.leadNotFound": "Заявка не найдена.",
  "err.pipeline.badOwner": "Такого сотрудника нет в команде магазина.",
  "err.catalog.sheetBadLink": "Нужна ссылка на Google Таблицу (docs.google.com/spreadsheets/…)",
  "err.auth.shopSwitch": "Этот магазин не связан с вашим.",
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
  "err.admin.giftSaleAmounts": "Укажите хотя бы один номинал.",
  "err.server.failed":
    "Не удалось выполнить действие: сбой на сервере. Попробуйте ещё раз — мы уже получили отчёт.",
  "err.server.badInput": "Данные формы не прошли проверку. Проверьте поля и попробуйте ещё раз.",
  "err.assist.noKey": "ИИ-помощник недоступен: на платформе не задан ключ.",
  "err.assist.preview": "Предпросмотр: вызовы ИИ выключены, чтобы не тратить деньги платформы.",
  "err.assist.noName": "Сначала напишите название товара.",
  "err.assist.limit": "На сегодня черновики закончились ({limit} в день). Попробуйте завтра.",
  "err.assist.budget": "Дневной предел расходов ИИ исчерпан. Попробуйте завтра.",
  "err.assist.balance": "ИИ-баланс закончился. Пополните его в разделе «ИИ-баланс».",
  "err.assist.busy": "ИИ-помощник сейчас занят. Попробуйте ещё раз.",
  "err.assist.failed": "ИИ-помощник не ответил. Попробуйте ещё раз.",
  "err.assist.salesEmpty": "За оба периода нет продаж — объяснять нечего.",
  "err.assist.salesLimit":
    "Дневной предел запросов к ИИ-помощнику исчерпан ({limit} в день вместе с черновиками). Попробуйте завтра.",
  "err.assist.noProduct": "Товар не найден.",
  "err.review.notFound": "Отзыв не найден.",
  "err.ticket.notFound": "Обращение не найдено.",
  "err.customer.notFound": "Покупатель не найден.",
  "err.loyalty.negative": "Нельзя списать больше баллов, чем есть: на балансе {points}.",
  "err.loyalty.busy": "Баланс менялся одновременно с вашей правкой. Обновите страницу и повторите.",
  "err.loyalty.tiers": "Уровней может быть не больше {max}.",
  "err.loyalty.tierInvalid":
    "У каждого уровня нужны название (до 40 знаков), сумма от 0 и процент от 1 до 100.",
  "err.loyalty.tierDup": "Суммы «от» у уровней не должны повторяться.",
  "err.invoice.empty": "Добавьте хотя бы одну позицию.",
  "err.invoice.unavailable": "Товар скрыт, удалён или вариант выбран неверно.",
  "err.invoice.mixed": "Цифровые и физические товары — разными счетами.",
  "err.invoice.digitalLimit": "Цифровой товар — одна штука в счёте.",
  "err.invoice.outOfStock": "Не хватает товара на складе.",
  "err.invoice.failed": "Не удалось собрать счёт, попробуйте ещё раз.",
  "err.invoice.cancelled":
    "Счёт не сохранился и отменён, покупателю ничего не ушло. Выставьте его заново.",
  "err.invoice.noCustomer": "Покупатель не найден.",
  "err.invoice.blocked": "Покупатель заблокирован.",
  "err.invoice.noShopInChannel":
    "В этом канале выключено оформление заказа — счёт покупатель не сможет оплатить.",
  "err.invoice.noBot": "У магазина не подключён Telegram-бот.",
  "err.invoice.linkPhysical":
    "Физические товары ссылкой на сайт не выставить: покупателю нужно выбрать дату и адрес. Включите оформление заказа в этом канале.",
  "err.invoice.noPayment": "Не настроены способы оплаты магазина.",
  "err.ticket.badAssignee": "Такого сотрудника нет в команде магазина.",
  "err.review.notDelivered":
    "Ответ не доставлен: покупатель недоступен в своём канале (заблокировал бота или диалог закрыт).",
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
  "err.admin.chatAttachmentBad":
    "Этот файл отправить нельзя: фото — JPEG или PNG до 5 МБ, документ — PDF, Word, Excel, PowerPoint, ZIP или TXT до 20 МБ.",
  "err.admin.tgBuyerUnreachable":
    "Покупатель недоступен в Telegram: он заблокировал бота или удалил аккаунт.",
  "err.admin.tgFileRejected":
    "Telegram не принял файл: проверьте размер и формат или отправьте его документом.",
  "err.admin.channelRefused": "Сообщение не ушло: {reason}",
  "err.admin.waWindowNoTemplate":
    "Прошло больше 24 часов с последнего сообщения покупателя — WhatsApp разрешает писать только одобренным шаблоном. Задайте его: Настройки → «Автоответчик · WhatsApp» → «Шаблон для сообщений вне 24-часового окна».",
  "err.admin.waNoPhone":
    "Прошло больше 24 часов с последнего сообщения покупателя, а его номера нет — шаблон отправить некуда.",
  "err.admin.igWindowClosed":
    "Прошло больше 24 часов с последнего сообщения покупателя — Instagram не даёт написать ему первым. Ответ уйдёт, когда он напишет сам.",
  "err.admin.igWindowLink":
    "Прошло больше 24 часов с последнего сообщения покупателя — Instagram не даёт написать ему первым. Ответ уйдёт, когда он напишет сам. Ссылка на его заказ: {url}",
  // CRM, Instagram, акции, возвратные продажи
  "err.admin.crmUrl": "Адрес должен начинаться с https:// и вести на внешний сервер.",
  "err.admin.crmSaveFirst": "Сначала сохраните адрес вебхука.",
  "err.admin.igPostNotFound": "Zernio не нашёл публикацию по ссылке — проверьте ссылку и аккаунт.",
  "err.admin.igZernioDenied":
    "Zernio не даёт доступа к профилю или аккаунту Instagram этого магазина, поэтому правила и публикации не видны. Напишите оператору платформы: нужно заново привязать профиль Zernio.",
  "err.admin.igZernioUnavailable":
    "Zernio сейчас не отвечает — правила и публикации не загрузились. Обновите страницу через пару минут.",
  "err.admin.offerEnd": "Окончание акции должно быть позже начала.",
  "err.admin.offerPriceScope": "Новую цену можно задать только для товара, не для категории.",
  "err.admin.offerPriceHigher": "Новая цена должна быть ниже обычной цены товара.",
  "err.admin.offerPercent": "Скидка — от 1 до 99 процентов.",
  "err.admin.offerCategory": "Выберите категорию.",
  "err.admin.offerProduct": "Выберите товар.",
  "err.admin.offersFull": "Слишком много акций: удалите прошедшие, прежде чем добавлять новые.",
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
  "msg.orders.alreadyReminded": "Напоминание об этом заказе уже отправлено",
  "msg.orders.remindFailed": "Не удалось отправить",
  // курсы (core/courses)
  "err.course.noProduct": "Товар не найден.",
  "err.course.physical": "Курс можно сделать только из цифрового товара, не из физического.",
  "err.course.tooMany": "В курсе не больше {max} уроков.",
  "err.course.noTitle": "У урока {lesson} нет названия.",
  "err.course.badLink": "Ссылка в уроке {lesson} должна начинаться с https://.",
  "err.course.tooManyFiles": "В уроке {lesson} не больше {max} файлов.",
  "err.course.emptyLesson": "Урок {lesson} пустой: добавьте текст, файл или ссылку.",
  "err.course.badSchedule": "Уроки можно открывать раз в 1–60 дней.",
  "err.course.badChannel": "Канал курса: id вида -1001234567890 или @имя_канала.",
  "err.course.badCohort":
    "Поток {cohort}: укажите дату и время старта; последний день набора — датой.",
  "err.course.badTariff": "Срок доступа тарифа — от 1 до 3650 дней.",
  "err.course.badLesson": "Урок {lesson} повреждён — удалите его и добавьте заново.",
  "err.broadcast.badSegment": "Сегмент заполнен не полностью.",
  "err.broadcast.badSchedule": "Время отправки — от минуты до 60 дней вперёд.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "err.auth.ownerOnly": "Мұны тек дүкен иесі өзгерте алады.",
  "err.auth.viewOnly": "Сіздің рөліңізге өзгерту құқығы берілмеген — тек қарау.",
  "err.auth.accountantDenied": "Бұл бөлім бухгалтерге қолжетімсіз.",
  "err.auth.moduleOff": "«{module}» модулі тарифіңізге қосылмаған.",
  "err.homework.emptyRevise":
    "Нені түзету керегін жазыңыз: түсініктемесіз оқушы не дұрыс емес екенін түсінбейді.",
  "err.homework.stale":
    "Сіз бұрынғы нұсқаны қарап отырғанда оқушы жаңа нұсқа жіберді. Бетті жаңартыңыз.",
  "err.homework.notWaiting": "Бұл жұмыс тексеріліп қойған.",
  "err.curators.duplicate": "Екі куратордың Telegram-ы бірдей: қайталанғанын алып тастаңыз.",
  "err.pricelist.off": "Прайс бойынша кеңесші дүкенде қосылмаған — оны оператор қосады.",
  "err.pricelist.empty":
    "Файлда бірде-бір позиция табылмады. 1С-тен CSV түсірілімі керек: атауы, бөлімі, өлшемі, бағасы.",
  "err.pricelist.badUrl": "Сайт мекенжайы https:// деп басталуы керек",
  "err.pricelist.badRate": "Рубльдің теңгеге бағамы — 1-ден 20-ға дейінгі сан, мысалы 4,79.",
  "err.pricelist.badFile": "Файл табылмады — қайта жүктеңіз.",
  "err.pricelist.noMatch": "Прайстағыдай модельді көрсетіңіз: мысалы «Uchino Zero Twist».",
  "err.pipeline.leadNotFound": "Өтінім табылмады.",
  "err.pipeline.badOwner": "Дүкен командасында мұндай қызметкер жоқ.",
  "err.catalog.sheetBadLink": "Google Кестеге сілтеме керек (docs.google.com/spreadsheets/…)",
  "err.auth.shopSwitch": "Бұл дүкен сіздікімен байланыстырылмаған.",
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
  "err.admin.giftSaleAmounts": "Кемінде бір номинал көрсетіңіз.",
  "err.server.failed":
    "Әрекетті орындау мүмкін болмады: серверде ақау. Қайта көріңіз — есеп бізге жетті.",
  "err.server.badInput": "Форма деректері тексерістен өтпеді. Өрістерді тексеріп, қайта көріңіз.",
  "err.assist.noKey": "ЖИ-көмекші қолжетімсіз: платформада кілт берілмеген.",
  "err.assist.preview":
    "Алдын ала қарау: платформаның ақшасын жұмсамау үшін ЖИ шақырулары өшірулі.",
  "err.assist.noName": "Алдымен тауардың атауын жазыңыз.",
  "err.assist.limit": "Бүгінгі жобалар таусылды (күніне {limit}). Ертең қайталаңыз.",
  "err.assist.budget": "ЖИ шығынының күндік шегі таусылды. Ертең қайталаңыз.",
  "err.assist.balance": "ЖИ балансы таусылды. Оны «ЖИ балансы» бөлімінде толтырыңыз.",
  "err.assist.busy": "ЖИ-көмекші қазір бос емес. Қайта көріңіз.",
  "err.assist.failed": "ЖИ-көмекші жауап бермеді. Қайта көріңіз.",
  "err.assist.salesEmpty": "Екі кезеңде де сатылым жоқ — түсіндіретін ештеңе жоқ.",
  "err.assist.salesLimit":
    "ЖИ-көмекшіге күндізгі сұраныс шегі таусылды (жобалармен бірге күніне {limit}). Ертең қайталаңыз.",
  "err.assist.noProduct": "Тауар табылмады.",
  "err.review.notFound": "Пікір табылмады.",
  "err.ticket.notFound": "Өтініш табылмады.",
  "err.customer.notFound": "Сатып алушы табылмады.",
  "err.loyalty.negative": "Бар ұпайдан артық шегеруге болмайды: балансте {points}.",
  "err.loyalty.busy":
    "Баланс сіздің өзгертуіңізбен бір мезгілде өзгерді. Бетті жаңартып, қайталаңыз.",
  "err.loyalty.tiers": "Деңгей саны {max}-тен аспауы керек.",
  "err.loyalty.tierInvalid":
    "Әр деңгейге атау (40 таңбаға дейін), 0-ден бастап сома және 1-ден 100-ге дейін пайыз қажет.",
  "err.loyalty.tierDup": "Деңгейлердің «бастап» сомалары қайталанбауы керек.",
  "err.invoice.empty": "Кемінде бір позиция қосыңыз.",
  "err.invoice.unavailable": "Тауар жасырылған, жойылған немесе нұсқа қате таңдалған.",
  "err.invoice.mixed": "Цифрлық және физикалық тауарлар — бөлек шоттармен.",
  "err.invoice.digitalLimit": "Цифрлық тауар шотта бір дана ғана.",
  "err.invoice.outOfStock": "Қоймада тауар жетпейді.",
  "err.invoice.failed": "Шотты жинау мүмкін болмады, қайталап көріңіз.",
  "err.invoice.cancelled":
    "Шот сақталмай, бас тартылды, сатып алушыға ештеңе жіберілмеді. Шотты қайта шығарыңыз.",
  "err.invoice.noCustomer": "Сатып алушы табылмады.",
  "err.invoice.blocked": "Сатып алушы бұғатталған.",
  "err.invoice.noShopInChannel":
    "Бұл арнада тапсырыс беру өшірулі — сатып алушы шотты төлей алмайды.",
  "err.invoice.noBot": "Дүкенге Telegram-бот қосылмаған.",
  "err.invoice.linkPhysical":
    "Физикалық тауарларды сайтқа сілтемемен шығаруға болмайды: сатып алушыға күн мен мекенжайды таңдау керек. Осы арнада тапсырыс рәсімдеуді қосыңыз.",
  "err.invoice.noPayment": "Дүкеннің төлем тәсілдері бапталмаған.",
  "err.ticket.badAssignee": "Дүкен командасында мұндай қызметкер жоқ.",
  "err.review.notDelivered":
    "Жауап жеткізілмеді: сатып алушы өз арнасында қолжетімсіз (ботты бұғаттаған немесе диалог жабық).",
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
  "err.admin.chatAttachmentBad":
    "Бұл файлды жіберуге болмайды: фото — 5 МБ-қа дейінгі JPEG немесе PNG, құжат — 20 МБ-қа дейінгі PDF, Word, Excel, PowerPoint, ZIP немесе TXT.",
  "err.admin.tgBuyerUnreachable":
    "Сатып алушы Telegram-да қолжетімсіз: ол ботты бұғаттаған немесе аккаунтын жойған.",
  "err.admin.tgFileRejected":
    "Telegram файлды қабылдамады: өлшемі мен пішімін тексеріңіз немесе құжат ретінде жіберіңіз.",
  "err.admin.channelRefused": "Хабарлама жіберілмеді: {reason}",
  "err.admin.waWindowNoTemplate":
    "Сатып алушының соңғы хабарламасынан бері 24 сағаттан көп өтті — WhatsApp тек бекітілген шаблонмен жазуға рұқсат береді. Оны орнатыңыз: Баптаулар → «Автожауап · WhatsApp» → «24 сағаттық терезеден тыс хабарламалар шаблоны».",
  "err.admin.waNoPhone":
    "Сатып алушының соңғы хабарламасынан бері 24 сағаттан көп өтті, ал оның нөмірі жоқ — шаблонды жіберетін жер жоқ.",
  "err.admin.igWindowClosed":
    "Сатып алушының соңғы хабарламасынан бері 24 сағаттан көп өтті — Instagram оған бірінші жазуға рұқсат бермейді. Ол өзі жазғанда жауап кетеді.",
  "err.admin.igWindowLink":
    "Сатып алушының соңғы хабарламасынан бері 24 сағаттан көп өтті — Instagram оған бірінші жазуға рұқсат бермейді. Ол өзі жазғанда жауап кетеді. Оның тапсырысының сілтемесі: {url}",
  "err.admin.crmUrl": "Мекенжай https:// деп басталып, сыртқы серверге апаруы керек.",
  "err.admin.crmSaveFirst": "Алдымен вебхук мекенжайын сақтаңыз.",
  "err.admin.igPostNotFound":
    "Zernio сілтеме бойынша жарияланымды таппады — сілтеме мен аккаунтты тексеріңіз.",
  "err.admin.igZernioDenied":
    "Zernio бұл дүкеннің профиліне не Instagram аккаунтына рұқсат бермейді, сондықтан ережелер мен жарияланымдар көрінбейді. Платформа операторына жазыңыз: Zernio профилін қайта байлау керек.",
  "err.admin.igZernioUnavailable":
    "Zernio қазір жауап бермейді — ережелер мен жарияланымдар жүктелмеді. Бірнеше минуттан кейін бетті жаңартыңыз.",
  "err.admin.offerEnd": "Акция басталғаннан кейін аяқталуы керек.",
  "err.admin.offerPriceScope": "Жаңа бағаны тек тауарға қоюға болады, санатқа емес.",
  "err.admin.offerPriceHigher": "Жаңа баға тауардың әдеттегі бағасынан төмен болуы керек.",
  "err.admin.offerPercent": "Жеңілдік — 1-ден 99 пайызға дейін.",
  "err.admin.offerCategory": "Санатты таңдаңыз.",
  "err.admin.offerProduct": "Тауарды таңдаңыз.",
  "err.admin.offersFull": "Акция тым көп: жаңасын қосар алдында өткендерін жойыңыз.",
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
  "msg.orders.alreadyReminded": "Бұл тапсырыс туралы еске салу жіберіліп қойған",
  "msg.orders.remindFailed": "Жіберу мүмкін болмады",
  "err.course.noProduct": "Тауар табылмады.",
  "err.course.physical": "Курсты тек цифрлық тауардан жасауға болады, физикалық тауардан емес.",
  "err.course.tooMany": "Курста {max} сабақтан көп болмайды.",
  "err.course.noTitle": "{lesson}-сабақтың атауы жоқ.",
  "err.course.badLink": "{lesson}-сабақтағы сілтеме https:// деп басталуы керек.",
  "err.course.tooManyFiles": "{lesson}-сабақта {max} файлдан көп болмайды.",
  "err.course.emptyLesson": "{lesson}-сабақ бос: мәтін, файл немесе сілтеме қосыңыз.",
  "err.course.badSchedule": "Сабақтарды 1–60 күнде бір рет ашуға болады.",
  "err.course.badChannel": "Курс арнасы: -1001234567890 түріндегі id немесе @арна_аты.",
  "err.course.badCohort":
    "{cohort}-ағын: басталу күні мен уақытын көрсетіңіз; қабылдаудың соңғы күні — күнмен.",
  "err.course.badTariff": "Тарифтің қолжетімділік мерзімі — 1-ден 3650 күнге дейін.",
  "err.course.badLesson": "{lesson}-сабақ бүлінген — оны өшіріп, қайта қосыңыз.",
  "err.broadcast.badSegment": "Сегмент толық толтырылмаған.",
  "err.broadcast.badSchedule": "Жіберу уақыты — бір минуттан 60 күнге дейін алда.",
};

export const en: SectionDict<typeof ru> = {
  "err.auth.ownerOnly": "Only the shop owner can change this.",
  "err.auth.viewOnly": "Your role cannot make changes — view only.",
  "err.auth.accountantDenied": "This section is not available to the accountant.",
  "err.auth.moduleOff": "The “{module}” module is not included in your plan.",
  "err.homework.emptyRevise":
    "Write what to fix: without a comment the student won't know what's wrong.",
  "err.homework.stale":
    "The student sent a new version while you were viewing the previous one. Refresh the page.",
  "err.homework.notWaiting": "This work has already been reviewed.",
  "err.curators.duplicate": "Two curators have the same Telegram: remove the duplicate.",
  "err.pricelist.off":
    "The price-list consultant is not enabled for this shop — the operator turns it on.",
  "err.pricelist.empty":
    "No items found in the file. Upload a 1C export in CSV: name, section, size, price.",
  "err.pricelist.badUrl": "The website address must start with https://",
  "err.pricelist.badRate": "The RUB to KZT rate must be a number from 1 to 20, e.g. 4.79.",
  "err.pricelist.badFile": "File not found — please upload it again.",
  "err.pricelist.noMatch": "Enter the model as in the price list, e.g. “Uchino Zero Twist”.",
  "err.pipeline.leadNotFound": "Lead not found.",
  "err.pipeline.badOwner": "There is no such team member in this shop.",
  "err.catalog.sheetBadLink": "A Google Sheets link is needed (docs.google.com/spreadsheets/…)",
  "err.auth.shopSwitch": "This shop is not linked to yours.",
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
  "err.admin.giftSaleAmounts": "Enter at least one amount.",
  "err.server.failed":
    "The action failed because of a server error. Please try again — we have already received a report.",
  "err.server.badInput": "The form data did not pass validation. Check the fields and try again.",
  "err.assist.noKey": "The AI assistant is unavailable: the platform has no API key.",
  "err.assist.preview":
    "Preview mode: AI calls are turned off so the platform does not spend money.",
  "err.assist.noName": "Enter the product name first.",
  "err.assist.limit": "No drafts left for today ({limit} per day). Try again tomorrow.",
  "err.assist.budget": "The daily AI spending limit is used up. Try again tomorrow.",
  "err.assist.balance": "Your AI balance has run out. Top it up in the “AI balance” section.",
  "err.assist.busy": "The AI assistant is busy right now. Please try again.",
  "err.assist.failed": "The AI assistant did not respond. Please try again.",
  "err.assist.salesEmpty": "There are no sales in either period — nothing to explain.",
  "err.assist.salesLimit":
    "The daily limit of AI assistant requests is used up ({limit} a day, drafts included). Try again tomorrow.",
  "err.assist.noProduct": "Product not found.",
  "err.review.notFound": "Review not found.",
  "err.ticket.notFound": "Request not found.",
  "err.customer.notFound": "Customer not found.",
  "err.loyalty.negative": "You cannot subtract more points than the balance: {points} available.",
  "err.loyalty.busy":
    "The balance changed at the same time as your edit. Refresh the page and try again.",
  "err.loyalty.tiers": "There can be at most {max} levels.",
  "err.loyalty.tierInvalid":
    "Each level needs a name (up to 40 characters), an amount from 0 and a percent from 1 to 100.",
  "err.loyalty.tierDup": "The “from” amounts of the levels must not repeat.",
  "err.invoice.empty": "Add at least one item.",
  "err.invoice.unavailable": "The product is hidden, deleted or the variant is wrong.",
  "err.invoice.mixed": "Digital and physical products go in separate invoices.",
  "err.invoice.digitalLimit": "A digital product can be in an invoice only once.",
  "err.invoice.outOfStock": "Not enough stock.",
  "err.invoice.failed": "Could not build the invoice, please try again.",
  "err.invoice.cancelled":
    "The invoice was not saved and has been cancelled; nothing was sent to the buyer. Please issue it again.",
  "err.invoice.noCustomer": "Customer not found.",
  "err.invoice.blocked": "The customer is blocked.",
  "err.invoice.noShopInChannel":
    "Checkout is off in this channel, so the customer could not pay the invoice.",
  "err.invoice.noBot": "The shop has no Telegram bot connected.",
  "err.invoice.linkPhysical":
    "Physical goods can't be invoiced by a website link: the customer has to pick a date and address. Turn on checkout in this channel.",
  "err.invoice.noPayment": "The shop has no payment methods set up.",
  "err.ticket.badAssignee": "There is no such member in the shop team.",
  "err.review.notDelivered":
    "The reply was not delivered: the customer is unreachable in their channel (blocked the bot or the chat is closed).",
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
  "err.admin.chatAttachmentBad":
    "This file cannot be sent: a photo must be JPEG or PNG up to 5 MB, a document PDF, Word, Excel, PowerPoint, ZIP or TXT up to 20 MB.",
  "err.admin.tgBuyerUnreachable":
    "The buyer is unreachable in Telegram: they blocked the bot or deleted the account.",
  "err.admin.tgFileRejected":
    "Telegram did not accept the file: check its size and format or send it as a document.",
  "err.admin.channelRefused": "The message was not sent: {reason}",
  "err.admin.waWindowNoTemplate":
    "More than 24 hours have passed since the customer's last message — WhatsApp only allows an approved template. Set it in Settings → “Autoresponder · WhatsApp” → “Template for messages outside the 24-hour window”.",
  "err.admin.waNoPhone":
    "More than 24 hours have passed since the customer's last message and there is no phone number to send a template to.",
  "err.admin.igWindowClosed":
    "More than 24 hours have passed since the customer's last message — Instagram does not let you message them first. Your reply can go out once they write.",
  "err.admin.igWindowLink":
    "More than 24 hours have passed since the customer's last message — Instagram does not let you message them first. Your reply can go out once they write. Link to their order: {url}",
  "err.admin.crmUrl": "The address must start with https:// and point to an external server.",
  "err.admin.crmSaveFirst": "Save the webhook address first.",
  "err.admin.igPostNotFound":
    "Zernio could not find a post at this link — check the link and the account.",
  "err.admin.igZernioDenied":
    "Zernio denies access to this shop’s profile or Instagram account, so rules and posts are not visible. Contact the platform operator: the Zernio profile needs to be linked again.",
  "err.admin.igZernioUnavailable":
    "Zernio is not responding right now — rules and posts did not load. Refresh the page in a couple of minutes.",
  "err.admin.offerEnd": "The offer must end after it starts.",
  "err.admin.offerPriceScope": "A new price can be set for a product only, not for a category.",
  "err.admin.offerPriceHigher": "The new price must be lower than the product's regular price.",
  "err.admin.offerPercent": "The discount is from 1 to 99 percent.",
  "err.admin.offerCategory": "Choose a category.",
  "err.admin.offerProduct": "Choose a product.",
  "err.admin.offersFull": "Too many offers: delete past ones before adding new ones.",
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
  "msg.orders.alreadyReminded": "A reminder for this order has already been sent",
  "msg.orders.remindFailed": "Could not send",
  "err.course.noProduct": "Product not found.",
  "err.course.physical": "A course can only be made from a digital product, not a physical one.",
  "err.course.tooMany": "A course can have at most {max} lessons.",
  "err.course.noTitle": "Lesson {lesson} has no title.",
  "err.course.badLink": "The link in lesson {lesson} must start with https://.",
  "err.course.tooManyFiles": "Lesson {lesson} can have at most {max} files.",
  "err.course.emptyLesson": "Lesson {lesson} is empty: add text, a file or a link.",
  "err.course.badSchedule": "Lessons can open once every 1–60 days.",
  "err.course.badChannel": "Course channel: an id like -1001234567890 or @channel_name.",
  "err.course.badCohort":
    "Cohort {cohort}: set the start date and time; the last enrolment day as a date.",
  "err.course.badTariff": "A tariff’s access period is 1 to 3650 days.",
  "err.course.badLesson": "Lesson {lesson} is damaged — delete it and add it again.",
  "err.broadcast.badSegment": "The segment is not filled in completely.",
  "err.broadcast.badSchedule": "Send time must be from one minute to 60 days ahead.",
};

export const uz: SectionDict<typeof ru> = {
  "err.auth.ownerOnly": "Buni faqat doʻkon egasi oʻzgartira oladi.",
  "err.auth.viewOnly": "Sizning rolingizda oʻzgartirish huquqi yoʻq — faqat koʻrish.",
  "err.auth.accountantDenied": "Bu boʻlim buxgalter uchun yopiq.",
  "err.auth.moduleOff": "«{module}» moduli tarifingizga ulanmagan.",
  "err.homework.emptyRevise":
    "Nimani tuzatish kerakligini yozing: izohsiz o‘quvchi nima noto‘g‘ri ekanini tushunmaydi.",
  "err.homework.stale":
    "Siz avvalgi versiyani ko‘rayotganingizda o‘quvchi yangi versiya yubordi. Sahifani yangilang.",
  "err.homework.notWaiting": "Bu ish allaqachon tekshirilgan.",
  "err.curators.duplicate": "Ikki kuratorda bir xil Telegram: takrorini olib tashlang.",
  "err.pricelist.off": "Narxnoma bo‘yicha maslahatchi do‘konda yoqilmagan — uni operator yoqadi.",
  "err.pricelist.empty":
    "Faylda birorta ham pozitsiya topilmadi. 1C dan CSV eksport kerak: nomi, bo‘lim, o‘lcham, narx.",
  "err.pricelist.badUrl": "Sayt manzili https:// bilan boshlanishi kerak",
  "err.pricelist.badRate": "Rublning tengega kursi — 1 dan 20 gacha son, masalan 4,79.",
  "err.pricelist.badFile": "Fayl topilmadi — qaytadan yuklang.",
  "err.pricelist.noMatch": "Modelni narxnomadagidek kiriting: masalan «Uchino Zero Twist».",
  "err.pipeline.leadNotFound": "Ariza topilmadi.",
  "err.pipeline.badOwner": "Doʻkon jamoasida bunday xodim yoʻq.",
  "err.catalog.sheetBadLink": "Google Jadval havolasi kerak (docs.google.com/spreadsheets/…)",
  "err.auth.shopSwitch": "Bu doʻkon sizniki bilan bogʻlanmagan.",
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
  "err.admin.giftSaleAmounts": "Kamida bitta nominal kiriting.",
  "err.server.failed":
    "Amalni bajarib boʻlmadi: serverda nosozlik. Qayta urinib koʻring — hisobot bizga yetib keldi.",
  "err.server.badInput":
    "Forma maʼlumotlari tekshiruvdan oʻtmadi. Maydonlarni tekshirib, qayta urinib koʻring.",
  "err.assist.noKey": "AI-yordamchi mavjud emas: platformada kalit berilmagan.",
  "err.assist.preview":
    "Oldindan ko‘rish: platforma pulini sarflamaslik uchun AI chaqiruvlari o‘chirilgan.",
  "err.assist.noName": "Avval mahsulot nomini yozing.",
  "err.assist.limit": "Bugungi qoralamalar tugadi (kuniga {limit}). Ertaga urinib koʻring.",
  "err.assist.budget": "AI xarajatlarining kunlik chegarasi tugadi. Ertaga urinib koʻring.",
  "err.assist.balance": "AI balansi tugadi. Uni «AI balansi» boʻlimida toʻldiring.",
  "err.assist.busy": "AI yordamchi hozir band. Qayta urinib koʻring.",
  "err.assist.failed": "AI-yordamchi javob bermadi. Qayta urinib koʻring.",
  "err.assist.salesEmpty": "Ikkala davrda ham savdo yo‘q — tushuntiradigan narsa yo‘q.",
  "err.assist.salesLimit":
    "AI yordamchiga kunlik so‘rovlar chegarasi tugadi (qoralamalar bilan birga kuniga {limit} ta). Ertaga urinib ko‘ring.",
  "err.assist.noProduct": "Mahsulot topilmadi.",
  "err.review.notFound": "Sharh topilmadi.",
  "err.ticket.notFound": "Murojaat topilmadi.",
  "err.customer.notFound": "Xaridor topilmadi.",
  "err.loyalty.negative": "Balansdagidan koʻp ball ayirib boʻlmaydi: balansda {points}.",
  "err.loyalty.busy":
    "Balans siz oʻzgartirgan paytda oʻzgardi. Sahifani yangilab, qayta urinib koʻring.",
  "err.loyalty.tiers": "Darajalar soni {max} tadan oshmasligi kerak.",
  "err.loyalty.tierInvalid":
    "Har bir daraja uchun nom (40 belgigacha), 0 dan boshlab summa va 1 dan 100 gacha foiz kerak.",
  "err.loyalty.tierDup": "Darajalarning «dan» summalari takrorlanmasligi kerak.",
  "err.invoice.empty": "Kamida bitta pozitsiya qoʻshing.",
  "err.invoice.unavailable": "Mahsulot yashirilgan, oʻchirilgan yoki variant notoʻgʻri tanlangan.",
  "err.invoice.mixed": "Raqamli va jismoniy mahsulotlar — alohida hisoblar bilan.",
  "err.invoice.digitalLimit": "Raqamli mahsulot hisobda faqat bitta.",
  "err.invoice.outOfStock": "Omborda mahsulot yetarli emas.",
  "err.invoice.failed": "Hisobni yigʻib boʻlmadi, qayta urinib koʻring.",
  "err.invoice.cancelled":
    "Hisob saqlanmadi va bekor qilindi, xaridorga hech narsa yuborilmadi. Hisobni qayta chiqaring.",
  "err.invoice.noCustomer": "Xaridor topilmadi.",
  "err.invoice.blocked": "Xaridor bloklangan.",
  "err.invoice.noShopInChannel":
    "Bu kanalda buyurtma berish oʻchirilgan — xaridor hisobni toʻlay olmaydi.",
  "err.invoice.noBot": "Doʻkonga Telegram-bot ulanmagan.",
  "err.invoice.linkPhysical":
    "Jismoniy tovarlarni saytga havola bilan chiqarib boʻlmaydi: xaridor sana va manzilni tanlashi kerak. Bu kanalda buyurtma berishni yoqing.",
  "err.invoice.noPayment": "Doʻkonning toʻlov usullari sozlanmagan.",
  "err.ticket.badAssignee": "Doʻkon jamoasida bunday xodim yoʻq.",
  "err.review.notDelivered":
    "Javob yetkazilmadi: xaridor oʻz kanalida mavjud emas (botni bloklagan yoki suhbat yopilgan).",
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
  "err.admin.chatAttachmentBad":
    "Bu faylni yuborib boʻlmaydi: foto — 5 MB gacha JPEG yoki PNG, hujjat — 20 MB gacha PDF, Word, Excel, PowerPoint, ZIP yoki TXT.",
  "err.admin.tgBuyerUnreachable":
    "Xaridor Telegramda mavjud emas: u botni bloklagan yoki akkauntini oʻchirgan.",
  "err.admin.tgFileRejected":
    "Telegram faylni qabul qilmadi: hajmi va formatini tekshiring yoki hujjat sifatida yuboring.",
  "err.admin.channelRefused": "Xabar yuborilmadi: {reason}",
  "err.admin.waWindowNoTemplate":
    "Xaridorning oxirgi xabaridan beri 24 soatdan ko‘p vaqt o‘tdi — WhatsApp faqat tasdiqlangan shablon bilan yozishga ruxsat beradi. Uni sozlang: Sozlamalar → «Avtojavob · WhatsApp» → «24 soatlik oynadan tashqari xabarlar uchun shablon».",
  "err.admin.waNoPhone":
    "Xaridorning oxirgi xabaridan beri 24 soatdan ko‘p vaqt o‘tdi, uning raqami esa yo‘q — shablonni yuborib bo‘lmaydi.",
  "err.admin.igWindowClosed":
    "Xaridorning oxirgi xabaridan beri 24 soatdan ko‘p vaqt o‘tdi — Instagram unga birinchi bo‘lib yozishga ruxsat bermaydi. U o‘zi yozganda javob ketadi.",
  "err.admin.igWindowLink":
    "Xaridorning oxirgi xabaridan beri 24 soatdan ko‘p vaqt o‘tdi — Instagram unga birinchi bo‘lib yozishga ruxsat bermaydi. U o‘zi yozganda javob ketadi. Buyurtmasiga havola: {url}",
  "err.admin.crmUrl": "Manzil https:// bilan boshlanishi va tashqi serverga olib borishi kerak.",
  "err.admin.crmSaveFirst": "Avval webhook manzilini saqlang.",
  "err.admin.igPostNotFound":
    "Zernio havola boʻyicha postni topmadi — havola va akkauntni tekshiring.",
  "err.admin.igZernioDenied":
    "Zernio bu doʻkonning profili yoki Instagram akkauntiga ruxsat bermaydi, shuning uchun qoidalar va postlar koʻrinmaydi. Platforma operatoriga yozing: Zernio profilini qayta bogʻlash kerak.",
  "err.admin.igZernioUnavailable":
    "Zernio hozir javob bermayapti — qoidalar va postlar yuklanmadi. Bir necha daqiqadan soʻng sahifani yangilang.",
  "err.admin.offerEnd": "Aksiya boshlanganidan keyin tugashi kerak.",
  "err.admin.offerPriceScope": "Yangi narxni faqat mahsulotga qo‘yish mumkin, toifaga emas.",
  "err.admin.offerPriceHigher": "Yangi narx mahsulotning odatdagi narxidan past bo‘lishi kerak.",
  "err.admin.offerPercent": "Chegirma — 1 dan 99 foizgacha.",
  "err.admin.offerCategory": "Toifani tanlang.",
  "err.admin.offerProduct": "Mahsulotni tanlang.",
  "err.admin.offersFull":
    "Aksiyalar juda ko‘p: yangisini qo‘shishdan oldin o‘tganlarini o‘chiring.",
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
  "msg.orders.alreadyReminded": "Bu buyurtma haqida eslatma allaqachon yuborilgan",
  "msg.orders.remindFailed": "Yuborib boʻlmadi",
  "err.course.noProduct": "Mahsulot topilmadi.",
  "err.course.physical":
    "Kursni faqat raqamli mahsulotdan yaratish mumkin, jismoniy mahsulotdan emas.",
  "err.course.tooMany": "Kursda {max} tadan ortiq dars boʻlmaydi.",
  "err.course.noTitle": "{lesson}-darsning nomi yoʻq.",
  "err.course.badLink": "{lesson}-darsdagi havola https:// bilan boshlanishi kerak.",
  "err.course.tooManyFiles": "{lesson}-darsda {max} tadan ortiq fayl boʻlmaydi.",
  "err.course.emptyLesson": "{lesson}-dars boʻsh: matn, fayl yoki havola qoʻshing.",
  "err.course.badSchedule": "Darslarni 1–60 kunda bir marta ochish mumkin.",
  "err.course.badChannel": "Kurs kanali: -1001234567890 ko‘rinishidagi id yoki @kanal_nomi.",
  "err.course.badCohort":
    "{cohort}-oqim: boshlanish sanasi va vaqtini kiriting; qabulning oxirgi kuni — sana bilan.",
  "err.course.badTariff": "Tarifning kirish muddati — 1 dan 3650 kungacha.",
  "err.course.badLesson": "{lesson}-dars buzilgan — uni oʻchirib, qaytadan qoʻshing.",
  "err.broadcast.badSegment": "Segment to'liq to'ldirilmagan.",
  "err.broadcast.badSchedule": "Yuborish vaqti — bir daqiqadan 60 kungacha oldinda.",
};
