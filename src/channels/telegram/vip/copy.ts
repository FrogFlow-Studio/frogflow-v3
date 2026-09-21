import type { Locale } from "@/core/i18n/locale";

/**
 * Тексты VIP-бота покупателю на четырёх языках — перенесены из v1 как есть.
 * Ответы администратору (подтверждение/отклонение) — только по-русски.
 */
export type VipCopyKey =
  | "btnRenew"
  | "btnStatus"
  | "btnId"
  | "btnHelp"
  | "btnLang"
  | "chooseLanguage"
  | "languageSaved"
  | "statusTitle"
  | "statusActive"
  | "statusTariff"
  | "statusValidUntil"
  | "statusRenewHint"
  | "statusPending"
  | "statusPendingHint"
  | "statusNone"
  | "statusNoneHint"
  | "helpTitle"
  | "helpRenewLine"
  | "helpStatusLine"
  | "helpIdLine"
  | "helpPhotoLine"
  | "helpCommandsLine"
  | "myIdLabel"
  | "myIdUsername"
  | "myIdHint"
  | "tariffsLoadError"
  | "tariffsEmptyRenew"
  | "tariffsEmptyDefault"
  | "tariffsIntroInGroup"
  | "tariffsIntroRenew"
  | "tariffsIntroDefault"
  | "entryTitle"
  | "entryDesc"
  | "entryPriceLabel"
  | "entryAfterPay"
  | "entryFurtherRenew"
  | "entryPayButton"
  | "tariffLinkNotFound"
  | "vipMenuPinned"
  | "startPendingTitle"
  | "startPendingNoNewNeeded"
  | "startPendingSendProof"
  | "startPendingStatusHint"
  | "startRenewInGroup"
  | "startRenewNotInGroup"
  | "startWelcome"
  | "assignedRenewInGroup"
  | "assignedRenewNotInGroup"
  | "assignedAfterPay"
  | "payButton"
  | "otherPublicTariffs"
  | "tariffNotFoundShort"
  | "tariffInactive"
  | "entryOnlyForNew"
  | "defaultPaymentInstructions"
  | "createRequestFailed"
  | "paymentChosenLabel"
  | "paymentDueLabel"
  | "paymentAfterPay"
  | "noPendingTariff"
  | "proofResubmitNotified"
  | "proofResubmitQuiet"
  | "proofReceived"
  | "alreadyPendingPublic"
  | "sendProofIfNotYet"
  | "tempError";

/** All customer-facing VIP bot copy. Admin-only replies stay hardcoded Russian below. */
export const vipCopy: Record<Locale, Record<VipCopyKey, string>> = {
  ru: {
    btnRenew: "🔄 Продлить",
    btnStatus: "📋 Мой статус",
    btnId: "🆔 Мой ID",
    btnHelp: "ℹ️ Помощь",
    btnLang: "🌐 Язык",
    chooseLanguage: "Выберите язык",
    languageSaved: "✅ Язык сохранён.",
    statusTitle: "📋 <b>Ваш VIP статус</b>",
    statusActive: "Статус: <b>активен</b>",
    statusTariff: "Тариф:",
    statusValidUntil: "Действует до:",
    statusRenewHint: "Чтобы продлить заранее — нажмите «{btn}».",
    statusPending: "Статус: <b>ожидает подтверждения оплаты</b>",
    statusPendingHint: "Если ещё не отправили чек — пришлите скриншот оплаты в этот чат.",
    statusNone: "Сейчас нет активной подписки.",
    statusNoneHint: "Нажмите «{btn}» или /start, чтобы оформить доступ.",
    helpTitle: "ℹ️ <b>Помощь VIP</b>",
    helpRenewLine: "• <b>{btn}</b> — выбрать тариф / продлить доступ",
    helpStatusLine: "• <b>{btn}</b> — срок подписки и статус оплаты",
    helpIdLine: "• <b>{btn}</b> — ваш Telegram ID (для ручного добавления)",
    helpPhotoLine: "• После оплаты пришлите <b>чек</b> в этот чат — фото или файлом",
    helpCommandsLine: "Команды: /start — меню, /id — ваш ID",
    myIdLabel: "Ваш Telegram ID:",
    myIdUsername: "Username:",
    myIdHint: "Этот ID нужен для ручного добавления в VIP-админке.",
    tariffsLoadError: "Не удалось загрузить тарифы. Попробуйте позже.",
    tempError: "Не удалось выполнить запрос. Попробуйте ещё раз через минуту.",
    tariffsEmptyRenew:
      "Нет публичных тарифов для продления. Используйте вашу персональную ссылку на тариф или напишите администратору.",
    tariffsEmptyDefault: "В данный момент нет доступных тарифов.",
    tariffsIntroInGroup:
      "Продление VIP: выберите тариф. После оплаты срок продлится — вы останетесь в группе, новая ссылка не нужна.",
    tariffsIntroRenew:
      "Выберите тариф. После подтверждения оплаты пришлём одноразовую ссылку для вступления в группу.",
    tariffsIntroDefault: "Выберите тариф для VIP-подписки:",
    entryTitle: "👋 <b>Первый вход в VIP</b>",
    entryDesc: "Разовый вход + доступ на {days} дн.",
    entryPriceLabel: "Стоимость:",
    entryAfterPay: "После оплаты и подтверждения вы получите ссылку в группу.",
    entryFurtherRenew: "Дальнейшее продление — по отдельным тарифам.",
    entryPayButton: "Оплатить вход — {price} {currency}",
    tariffLinkNotFound:
      "Тариф по этой ссылке не найден или выключен. Нажмите /start для общего списка.",
    vipMenuPinned: "Меню VIP закреплено внизу.",
    startPendingTitle: "⏳ У вас уже есть заявка <b>в ожидании подтверждения оплаты</b>.",
    startPendingNoNewNeeded: "Новый тариф оформлять не нужно.",
    startPendingSendProof: "Если чек ещё не отправили — пришлите скриншот оплаты в этот чат.",
    startPendingStatusHint: "Статус можно посмотреть кнопкой «{btn}».",
    startRenewInGroup: "Продление VIP — кнопки меню внизу. Выберите тариф ниже.",
    startRenewNotInGroup:
      "Возврат в VIP — выберите тариф ниже. После оплаты придёт одноразовая ссылка в группу.",
    startWelcome: "Добро пожаловать в VIP-бот. Меню внизу экрана — тарифы ниже.",
    assignedRenewInGroup: "Продление VIP — ваш персональный тариф:",
    assignedRenewNotInGroup: "Ваш персональный тариф VIP:",
    assignedAfterPay: "После оплаты — одноразовая ссылка в группу.",
    payButton: "Оплатить — {price} {currency}",
    otherPublicTariffs: "Другие публичные тарифы",
    tariffNotFoundShort: "Тариф не найден.",
    tariffInactive: "Этот тариф больше не активен. Нажмите /start чтобы выбрать другой.",
    entryOnlyForNew:
      "Тариф «Первый вход» доступен только новым участникам. Выберите тариф продления:",
    defaultPaymentInstructions: "Оплатите по реквизитам и пришлите скриншот.",
    createRequestFailed: "Не удалось создать заявку. Попробуйте позже.",
    paymentChosenLabel: "Вы выбрали тариф:",
    paymentDueLabel: "К оплате:",
    paymentAfterPay:
      "После оплаты отправьте чек прямо в этот чат — фото или файлом (PDF тоже подойдёт).",
    noPendingTariff: "У вас нет ожидающих оплаты тарифов. Нажмите /start чтобы выбрать тариф.",
    proofResubmitNotified:
      "✅ Новый чек получен! Предыдущий заменён. Ожидайте подтверждения администратором.",
    proofResubmitQuiet: "✅ Чек обновлён. Не присылайте чаще раза в минуту — админ уже уведомлён.",
    proofReceived:
      "✅ Чек получен! Ожидайте подтверждения администратором. После проверки вы получите доступ к VIP-группе.",
    alreadyPendingPublic: "⏳ Заявка уже ждёт подтверждения оплаты",
    sendProofIfNotYet: "Пришлите чек, если ещё не отправили.",
  },
  kk: {
    btnRenew: "🔄 Ұзарту",
    btnStatus: "📋 Менің мәртебем",
    btnId: "🆔 Менің ID-м",
    btnHelp: "ℹ️ Көмек",
    btnLang: "🌐 Тіл",
    chooseLanguage: "Тілді таңдаңыз",
    languageSaved: "✅ Тіл сақталды.",
    statusTitle: "📋 <b>Сіздің VIP мәртебеңіз</b>",
    statusActive: "Мәртебе: <b>белсенді</b>",
    statusTariff: "Тариф:",
    statusValidUntil: "Мерзімі дейін:",
    statusRenewHint: "Мерзімінен бұрын ұзарту үшін «{btn}» батырмасын басыңыз.",
    statusPending: "Мәртебе: <b>төлем растауын күтуде</b>",
    statusPendingHint: "Егер чекті әлі жібермеген болсаңыз — төлем скриншотын осы чатқа жіберіңіз.",
    statusNone: "Қазір белсенді жазылым жоқ.",
    statusNoneHint: "Қолжетімділік алу үшін «{btn}» батырмасын немесе /start пәрменін басыңыз.",
    helpTitle: "ℹ️ <b>VIP көмегі</b>",
    helpRenewLine: "• <b>{btn}</b> — тарифті таңдау / қолжетімділікті ұзарту",
    helpStatusLine: "• <b>{btn}</b> — жазылым мерзімі және төлем мәртебесі",
    helpIdLine: "• <b>{btn}</b> — сіздің Telegram ID-іңіз (қолмен қосу үшін)",
    helpPhotoLine: "• Төлегеннен кейін <b>чекті</b> осы чатқа жіберіңіз — фото немесе файл түрінде",
    helpCommandsLine: "Пәрмендер: /start — мәзір, /id — сіздің ID",
    myIdLabel: "Сіздің Telegram ID-іңіз:",
    myIdUsername: "Username:",
    myIdHint: "Бұл ID VIP-әкімшілікте қолмен қосу үшін керек.",
    tariffsLoadError: "Тарифтерді жүктеу мүмкін болмады. Кейінірек қайталап көріңіз.",
    tempError: "Сұранысты орындау мүмкін болмады. Бір минуттан кейін қайталап көріңіз.",
    tariffsEmptyRenew:
      "Ұзарту үшін жария тарифтер жоқ. Жеке тариф сілтемеңізді пайдаланыңыз немесе әкімшіге жазыңыз.",
    tariffsEmptyDefault: "Қазіргі уақытта қолжетімді тарифтер жоқ.",
    tariffsIntroInGroup:
      "VIP ұзарту: тарифті таңдаңыз. Төлегеннен кейін мерзім ұзарады — сіз топта қаласыз, жаңа сілтеме керек емес.",
    tariffsIntroRenew:
      "Тарифті таңдаңыз. Төлем расталғаннан кейін топқа кіру үшін бір реттік сілтеме жібереміз.",
    tariffsIntroDefault: "VIP жазылымы үшін тарифті таңдаңыз:",
    entryTitle: "👋 <b>VIP-ке алғашқы кіру</b>",
    entryDesc: "Бір реттік кіру + {days} күнге қолжетімділік.",
    entryPriceLabel: "Құны:",
    entryAfterPay: "Төлем расталғаннан кейін топқа сілтеме аласыз.",
    entryFurtherRenew: "Келесі ұзартулар — жеке тарифтер бойынша.",
    entryPayButton: "Кіру үшін төлеу — {price} {currency}",
    tariffLinkNotFound:
      "Бұл сілтеме бойынша тариф табылмады немесе өшірілген. Жалпы тізім үшін /start басыңыз.",
    vipMenuPinned: "VIP мәзірі төменде бекітілген.",
    startPendingTitle: "⏳ Сізде <b>төлем растауын күтетін</b> өтінім бұрыннан бар.",
    startPendingNoNewNeeded: "Жаңа тариф рәсімдеудің қажеті жоқ.",
    startPendingSendProof:
      "Егер чекті әлі жібермеген болсаңыз — төлем скриншотын осы чатқа жіберіңіз.",
    startPendingStatusHint: "Мәртебені «{btn}» батырмасынан көруге болады.",
    startRenewInGroup: "VIP ұзарту — мәзір батырмалары төменде. Тарифті төменнен таңдаңыз.",
    startRenewNotInGroup:
      "VIP-ке қайта оралу — тарифті төменнен таңдаңыз. Төлегеннен кейін топқа бір реттік сілтеме келеді.",
    startWelcome: "VIP-ботқа қош келдіңіз. Мәзір экранның төменінде — тарифтер төменде.",
    assignedRenewInGroup: "VIP ұзарту — сіздің жеке тарифіңіз:",
    assignedRenewNotInGroup: "Сіздің жеке VIP тарифіңіз:",
    assignedAfterPay: "Төлегеннен кейін — топқа бір реттік сілтеме.",
    payButton: "Төлеу — {price} {currency}",
    otherPublicTariffs: "Басқа жария тарифтер",
    tariffNotFoundShort: "Тариф табылмады.",
    tariffInactive: "Бұл тариф енді белсенді емес. Басқасын таңдау үшін /start басыңыз.",
    entryOnlyForNew:
      "«Алғашқы кіру» тарифі тек жаңа қатысушыларға қолжетімді. Ұзарту тарифін таңдаңыз:",
    defaultPaymentInstructions: "Реквизиттер бойынша төлеп, скриншот жіберіңіз.",
    createRequestFailed: "Өтінім жасау мүмкін болмады. Кейінірек қайталап көріңіз.",
    paymentChosenLabel: "Сіз таңдаған тариф:",
    paymentDueLabel: "Төлеуге тиіс:",
    paymentAfterPay:
      "Төлегеннен кейін чекті осы чатқа тікелей жіберіңіз — фото немесе файл түрінде (PDF де жарайды).",
    noPendingTariff: "Сізде төлемді күтетін тарифтер жоқ. Тариф таңдау үшін /start басыңыз.",
    proofResubmitNotified: "✅ Жаңа чек алынды! Алдыңғысы ауыстырылды. Әкімші растауын күтіңіз.",
    proofResubmitQuiet:
      "✅ Чек жаңартылды. Минутына бір реттен жиі жібермеңіз — әкімшіге хабарланды.",
    proofReceived:
      "✅ Чек алынды! Әкімші растауын күтіңіз. Тексеруден кейін VIP-топқа қолжетімділік аласыз.",
    alreadyPendingPublic: "⏳ Өтінім төлем растауын күтуде",
    sendProofIfNotYet: "Егер әлі жібермеген болсаңыз — чекті жіберіңіз.",
  },
  en: {
    btnRenew: "🔄 Renew",
    btnStatus: "📋 My status",
    btnId: "🆔 My ID",
    btnHelp: "ℹ️ Help",
    btnLang: "🌐 Language",
    chooseLanguage: "Choose your language",
    languageSaved: "✅ Language saved.",
    statusTitle: "📋 <b>Your VIP status</b>",
    statusActive: "Status: <b>active</b>",
    statusTariff: "Plan:",
    statusValidUntil: "Valid until:",
    statusRenewHint: "To renew early — tap «{btn}».",
    statusPending: "Status: <b>awaiting payment confirmation</b>",
    statusPendingHint:
      "If you haven't sent a receipt yet — send a payment screenshot to this chat.",
    statusNone: "You have no active subscription right now.",
    statusNoneHint: "Tap «{btn}» or /start to get access.",
    helpTitle: "ℹ️ <b>VIP help</b>",
    helpRenewLine: "• <b>{btn}</b> — choose a plan / renew access",
    helpStatusLine: "• <b>{btn}</b> — subscription term and payment status",
    helpIdLine: "• <b>{btn}</b> — your Telegram ID (for manual add)",
    helpPhotoLine: "• After paying, send the <b>receipt</b> to this chat — as a photo or a file",
    helpCommandsLine: "Commands: /start — menu, /id — your ID",
    myIdLabel: "Your Telegram ID:",
    myIdUsername: "Username:",
    myIdHint: "This ID is needed to add you manually in the VIP admin panel.",
    tariffsLoadError: "Couldn't load plans. Please try again later.",
    tempError: "Couldn't complete the request. Please try again in a minute.",
    tariffsEmptyRenew: "No public renewal plans. Use your personal plan link or contact the admin.",
    tariffsEmptyDefault: "No plans are available right now.",
    tariffsIntroInGroup:
      "VIP renewal: choose a plan. After payment your term extends — you stay in the group, no new link needed.",
    tariffsIntroRenew:
      "Choose a plan. After payment is confirmed we'll send a one-time link to join the group.",
    tariffsIntroDefault: "Choose a VIP subscription plan:",
    entryTitle: "👋 <b>First VIP entry</b>",
    entryDesc: "One-time entry + access for {days} days.",
    entryPriceLabel: "Price:",
    entryAfterPay: "After payment is confirmed, you'll get a link to the group.",
    entryFurtherRenew: "Further renewals use separate plans.",
    entryPayButton: "Pay for entry — {price} {currency}",
    tariffLinkNotFound:
      "The plan behind this link was not found or is disabled. Tap /start for the general list.",
    vipMenuPinned: "The VIP menu is pinned below.",
    startPendingTitle: "⏳ You already have a request <b>awaiting payment confirmation</b>.",
    startPendingNoNewNeeded: "No need to place a new plan.",
    startPendingSendProof:
      "If you haven't sent a receipt yet — send a payment screenshot to this chat.",
    startPendingStatusHint: "You can check the status with the «{btn}» button.",
    startRenewInGroup: "VIP renewal — the menu buttons are below. Choose a plan below.",
    startRenewNotInGroup:
      "Returning to VIP — choose a plan below. After payment a one-time link to the group will arrive.",
    startWelcome:
      "Welcome to the VIP bot. The menu is at the bottom of the screen — plans are below.",
    assignedRenewInGroup: "VIP renewal — your personal plan:",
    assignedRenewNotInGroup: "Your personal VIP plan:",
    assignedAfterPay: "After payment — a one-time link to the group.",
    payButton: "Pay — {price} {currency}",
    otherPublicTariffs: "Other public plans",
    tariffNotFoundShort: "Plan not found.",
    tariffInactive: "This plan is no longer active. Tap /start to choose another one.",
    entryOnlyForNew: "The «First entry» plan is only for new members. Choose a renewal plan:",
    defaultPaymentInstructions: "Pay using the details provided and send a screenshot.",
    createRequestFailed: "Couldn't create the request. Please try again later.",
    paymentChosenLabel: "You chose the plan:",
    paymentDueLabel: "Amount due:",
    paymentAfterPay:
      "After paying, send the receipt directly to this chat — as a photo or a file (PDF works too).",
    noPendingTariff: "You have no plans awaiting payment. Tap /start to choose a plan.",
    proofResubmitNotified:
      "✅ New receipt received! The previous one was replaced. Awaiting admin confirmation.",
    proofResubmitQuiet:
      "✅ Receipt updated. Please don't send more than once a minute — the admin has already been notified.",
    proofReceived:
      "✅ Receipt received! Awaiting admin confirmation. You'll get access to the VIP group once it's checked.",
    alreadyPendingPublic: "⏳ Your request is already awaiting payment confirmation",
    sendProofIfNotYet: "Send the receipt if you haven't yet.",
  },
  uz: {
    btnRenew: "🔄 Uzaytirish",
    btnStatus: "📋 Mening holatim",
    btnId: "🆔 Mening ID’im",
    btnHelp: "ℹ️ Yordam",
    btnLang: "🌐 Til",
    chooseLanguage: "Tilni tanlang",
    languageSaved: "✅ Til saqlandi.",
    statusTitle: "📋 <b>Sizning VIP holatingiz</b>",
    statusActive: "Holat: <b>faol</b>",
    statusTariff: "Tarif:",
    statusValidUntil: "Amal qilish muddati:",
    statusRenewHint: "Muddatidan oldin uzaytirish uchun «{btn}» tugmasini bosing.",
    statusPending: "Holat: <b>to‘lov tasdiqlanishini kutmoqda</b>",
    statusPendingHint:
      "Agar chekni hali yubormagan bo‘lsangiz — to‘lov skrinshotini shu chatga yuboring.",
    statusNone: "Hozircha faol obuna yo‘q.",
    statusNoneHint: "Kirish olish uchun «{btn}» tugmasini yoki /start buyrug‘ini bosing.",
    helpTitle: "ℹ️ <b>VIP yordami</b>",
    helpRenewLine: "• <b>{btn}</b> — tarif tanlash / kirishni uzaytirish",
    helpStatusLine: "• <b>{btn}</b> — obuna muddati va to‘lov holati",
    helpIdLine: "• <b>{btn}</b> — Telegram ID’ingiz (qo‘lda qo‘shish uchun)",
    helpPhotoLine: "• To‘lovdan so‘ng <b>chekni</b> shu chatga yuboring — foto yoki fayl sifatida",
    helpCommandsLine: "Buyruqlar: /start — menyu, /id — ID’ingiz",
    myIdLabel: "Sizning Telegram ID’ingiz:",
    myIdUsername: "Username:",
    myIdHint: "Bu ID VIP-adminpanelda qo‘lda qo‘shish uchun kerak.",
    tariffsLoadError: "Tariflarni yuklab bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.",
    tempError: "So‘rovni bajarib bo‘lmadi. Bir daqiqadan so‘ng qayta urinib ko‘ring.",
    tariffsEmptyRenew:
      "Uzaytirish uchun ommaviy tariflar yo‘q. Shaxsiy tarif havolangizdan foydalaning yoki administratorga yozing.",
    tariffsEmptyDefault: "Hozirda mavjud tariflar yo‘q.",
    tariffsIntroInGroup:
      "VIP’ni uzaytirish: tarifni tanlang. To‘lovdan so‘ng muddat uzayadi — siz guruhda qolasiz, yangi havola kerak emas.",
    tariffsIntroRenew:
      "Tarifni tanlang. To‘lov tasdiqlangach, guruhga kirish uchun bir martalik havola yuboramiz.",
    tariffsIntroDefault: "VIP obunasi uchun tarifni tanlang:",
    entryTitle: "👋 <b>VIP’ga birinchi kirish</b>",
    entryDesc: "Bir martalik kirish + {days} kunlik kirish huquqi.",
    entryPriceLabel: "Narxi:",
    entryAfterPay: "To‘lov tasdiqlangach guruhga havola olasiz.",
    entryFurtherRenew: "Keyingi uzaytirishlar alohida tariflar bo‘yicha amalga oshiriladi.",
    entryPayButton: "Kirish uchun to‘lash — {price} {currency}",
    tariffLinkNotFound:
      "Ushbu havoladagi tarif topilmadi yoki o‘chirilgan. Umumiy ro‘yxat uchun /start ni bosing.",
    vipMenuPinned: "VIP menyusi pastda mahkamlangan.",
    startPendingTitle: "⏳ Sizda allaqachon <b>to‘lov tasdiqlanishini kutayotgan</b> so‘rov bor.",
    startPendingNoNewNeeded: "Yangi tarif rasmiylashtirish shart emas.",
    startPendingSendProof:
      "Agar chekni hali yubormagan bo‘lsangiz — to‘lov skrinshotini shu chatga yuboring.",
    startPendingStatusHint: "Holatni «{btn}» tugmasi orqali ko‘rishingiz mumkin.",
    startRenewInGroup: "VIP’ni uzaytirish — menyu tugmalari pastda. Tarifni pastdan tanlang.",
    startRenewNotInGroup:
      "VIP’ga qaytish — tarifni pastdan tanlang. To‘lovdan so‘ng guruhga bir martalik havola keladi.",
    startWelcome: "VIP-botga xush kelibsiz. Menyu ekran pastida — tariflar pastda.",
    assignedRenewInGroup: "VIP’ni uzaytirish — sizning shaxsiy tarifingiz:",
    assignedRenewNotInGroup: "Sizning shaxsiy VIP tarifingiz:",
    assignedAfterPay: "To‘lovdan so‘ng — guruhga bir martalik havola.",
    payButton: "To‘lash — {price} {currency}",
    otherPublicTariffs: "Boshqa ommaviy tariflar",
    tariffNotFoundShort: "Tarif topilmadi.",
    tariffInactive: "Bu tarif endi faol emas. Boshqasini tanlash uchun /start ni bosing.",
    entryOnlyForNew:
      "«Birinchi kirish» tarifi faqat yangi a’zolar uchun. Uzaytirish tarifini tanlang:",
    defaultPaymentInstructions: "Rekvizitlar bo‘yicha to‘lang va skrinshot yuboring.",
    createRequestFailed: "So‘rov yaratib bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.",
    paymentChosenLabel: "Siz tanlagan tarif:",
    paymentDueLabel: "To‘lash summasi:",
    paymentAfterPay:
      "To‘lovdan so‘ng chekni to‘g‘ridan-to‘g‘ri shu chatga yuboring — foto yoki fayl sifatida (PDF ham bo‘ladi).",
    noPendingTariff:
      "Sizda to‘lovni kutayotgan tariflar yo‘q. Tarif tanlash uchun /start ni bosing.",
    proofResubmitNotified:
      "✅ Yangi chek qabul qilindi! Avvalgisi almashtirildi. Administrator tasdig‘ini kuting.",
    proofResubmitQuiet:
      "✅ Chek yangilandi. Daqiqasiga bir martadan ko‘p yubormang — administratorga allaqachon xabar berildi.",
    proofReceived:
      "✅ Chek qabul qilindi! Administrator tasdig‘ini kuting. Tekshiruvdan so‘ng VIP guruhiga kirish huquqini olasiz.",
    alreadyPendingPublic: "⏳ So‘rov allaqachon to‘lov tasdiqlanishini kutmoqda",
    sendProofIfNotYet: "Agar hali yubormagan bo‘lsangiz — chekni yuboring.",
  },
};
