import type { Locale } from "@/core/i18n/locale";
import { formatMoney } from "@/core/money/money";

/**
 * Тексты бота на четырёх языках. Раскладка главного меню и подписи кнопок —
 * те же, что у v1: покупатель, переехавший с v1, не должен заметить разницы.
 */
export type Msg = {
  chooseLanguage: string;
  languageSaved: string;
  chooseSection: string;
  catalog: string;
  search: string;
  cart: string;
  myOrders: string;
  /** Модуль courses: «Мои курсы» (channels/telegram/courses). */
  myCourses: string;
  /** Онлайн-школа: каталог называется «Курсы». */
  catalogCourses: string;
  instruction: string;
  information: string;
  catalogHeader: string;
  subcategories: string;
  emptyHere: string;
  showMore: string;
  back: string;
  backToCategories: string;
  navigation: string;
  addToCartBtn: string;
  priceFrom: (amount: string) => string;
  descPending: string;
  outOfStockLabel: string;
  /** Лист ожидания (модуль waitlist). */
  waitlistBtn: string;
  /** Апсейл (модуль upsell): «С этим берут». */
  upsellHeader: string;
  /** Квиз-подбор (модуль quiz). */
  quizBtn: string;
  /** Мини-helpdesk. */
  ticketPrompt: string;
  /** Быстрый вопрос «Как оплатить» при пустой корзине: страны и валюты, без реквизитов. */
  payMethods: (list: string) => string;
  ticketCreated: (no: number) => string;
  ticketAppended: (no: number) => string;
  ticketClosed: (no: number) => string;
  quizResult: string;
  quizNothing: string;
  quizNotReady: string;
  /** Telegram Stars. */
  payViaStarsBtn: (stars: number) => string;
  starsInvoiceTitle: (no: number) => string;
  starsInvoiceDesc: string;
  starsPaymentStale: string;
  waitlistJoined: string;
  backInStock: (name: string) => string;
  /** Ответ продавца на отзыв; оба аргумента — уже экранированный HTML. */
  reviewReply: (product: string, text: string) => string;
  productNotFound: string;
  added: string;
  unavailable: string;
  mixedCart: string;
  digitalLimit: string;
  outOfStock: string;
  cartEmpty: string;
  cartHeader: string;
  removeItem: (name: string) => string;
  total: (amount: string) => string;
  checkoutBtn: string;
  /** «Счёт из диалога»: продавец собрал корзину покупателю (core/cart/seller-cart). */
  invoiceHeader: string;
  invoiceFooter: string;
  /** Счёт ссылкой на страницу заказа на сайте (Instagram/WhatsApp без оформления в канале). */
  invoicePayLink: (no: number | string, url: string) => string;
  clearBtn: string;
  cartCleared: string;
  promoCodeBtn: string;
  removePromoBtn: string;
  promoCodePrompt: string;
  promoCodeInvalid: string;
  promoCodeUsed: string;
  discountFx: string;
  mixedCurrency: string;
  /** Корзина меньше минимальной суммы заказа магазина: минимум и сколько добрать. */
  minOrderBelow: (min: string, shortfall: string) => string;
  promoCodeRemoved: string;
  discountLine: (amount: string) => string;
  usePointsBtn: string;
  removePointsBtn: string;
  pointsBalanceLine: (n: number) => string;
  /** Уровень лояльности: имя, % начисления и (необязательно) «до следующего». */
  loyaltyTierLine: (name: string, percent: number, toNext: string | null) => string;
  loyaltyTierNext: (amount: string, name: string) => string;
  pointsDiscountLine: (amount: string) => string;
  /** Заказ не в валюте магазина: сколько баллов уходит за скидку (1 балл = 1 ₸). */
  pointsFxLine: (points: number, amount: string) => string;
  pointsEarned: (n: number) => string;
  /** Direct/WhatsApp: шаг «списать баллы?» при оформлении. */
  pointsAsk: (n: number) => string;
  /** Ответ на слово «баллы» в Instagram/WhatsApp: баланс и потолок списания. */
  pointsInfo: (n: number, currency: string, maxPercent: number) => string;
  pointsNone: (earnPercent: number) => string;
  pointsYesBtn: string;
  pointsNoBtn: string;
  giftCertificateBtn: string;
  removeGiftCertificateBtn: string;
  giftCertificateCodePrompt: string;
  giftCertificateInvalid: string;
  giftRestIssued: (code: string, sum: string) => string;
  giftCertificateRemoved: string;
  giftCertificateDiscountLine: (amount: string) => string;
  orderPaidByDiscounts: (no: number) => string;
  fulfillmentTypePrompt: string;
  fulfillmentTypePickupBtn: string;
  fulfillmentTypeDeliveryBtn: string;
  fulfillmentDatePrompt: (minDate: string) => string;
  fulfillmentSlotPrompt: string;
  approvalAskChanges: string;
  approvalChangesSent: string;
  approvalThanks: string;
  birthdayAsk: string;
  previewBtn: string;
  renewBtn: string;
  subOffBtn: string;
  subOffDone: string;
  renewUnavailable: string;
  birthdayInvalid: string;
  birthdaySaved: string;
  fulfillmentDateInvalid: string;
  fulfillmentDateTooEarly: (minDate: string) => string;
  deliveryZonePrompt: string;
  addressPrompt: string;
  fulfillmentNotePrompt: string;
  fulfillmentNoteSkipBtn: string;
  outOfStockAtCheckout: string;
  orderAcceptedOnReceipt: (no: number, total: string) => string;
  depositLine: (due: string, total: string) => string;
  afterProofPhysical: string;
  leadTimeLabel: (days: number) => string;
  choosePayMethod: string;
  /** Оплата — акцепт оферты; ссылки на опубликованные документы. */
  payConsent: (offer: string | null, privacy: string | null) => string;
  payViaRobokassaBtn: string;
  payViaCryptoBtn: string;
  cryptoHint: string;
  cryptoUnavailable: string;
  payViaStripeBtn: string;
  stripeHint: string;
  stripeUnavailable: string;
  payManualBtn: string;
  robokassaHint: string;
  paymentReceived: (no: number) => string;
  chooseCountry: string;
  countrySaved: (name: string) => string;
  paymentNotConfigured: string;
  countryNoLongerAvailable: string;
  phonePromptHtml: string;
  shareContactBtn: string;
  phoneInvalid: string;
  contactSaved: string;
  checkoutBusy: string;
  orderCreateFailed: string;
  manualTitleNew: (no: number) => string;
  amountToPay: (amount: string) => string;
  defaultInstructions: string;
  afterProofManual: string;
  sendReceiptPrompt: string;
  /** Напоминание об оплате (core/orders/pay-remind): заголовок и просьба прислать чек. */
  payReminderTitle: (no: number) => string;
  payReminderAfter: string;
  payReminderAmount: (amount: string) => string;
  payReminderDeposit: (due: string, total: string) => string;
  payReminderNoDetails: string;
  /** Счёт ссылкой (#194): оплата и чек — на странице заказа. */
  payReminderLink: (url: string) => string;
  proofReceived: (no: number) => string;
  balanceProofRejected: (no: number) => string;
  payBalanceBtn: (no: number) => string;
  balanceTitle: (no: number, sum: string) => string;
  balanceNoDetails: string;
  balanceHowTo: (card: boolean) => string;
  balanceNotDue: string;
  balanceProofWaiting: string;
  balanceProofReceived: (no: number) => string;
  balancePaid: (no: number, sum: string) => string;
  /** Instagram/WhatsApp: почта для выдачи письмом (перенос из v1). */
  emailAsk: string;
  emailAskOptional: string;
  emailSkipBtn: string;
  emailHint: string;
  emailSaved: (email: string) => string;
  emailSaveFailed: string;
  proofReceivedEmail: (no: number, email: string) => string;
  proofReceivedNeedEmail: (no: number) => string;
  proofDuplicate: string;
  proofFailed: string;
  proofBadFile: string;
  proofTooLarge: string;
  proofOrderClosed: string;
  orderDelivered: (no: number) => string;
  orderRejected: (no: number) => string;
  orderAccepted: (no: number) => string;
  orderRefunded: (no: number, full: boolean, sum: string) => string;
  searchPrompt: string;
  searchNothing: (q: string) => string;
  searchResults: (q: string, n: number) => string;
  /** Под страницей результатов, рядом с кнопкой «Показать ещё» (`searchmore:`). */
  searchShown: (shown: number, total: number) => string;
  /** `searchmore:` без запомненного запроса. */
  searchExpired: string;
  myOrdersEmpty: string;
  myOrdersHeader: string;
  resendBtn: string;
  /** «Повторить заказ»: те же товары снова в корзину. */
  reorderBtn: string;
  reorderDone: (n: number) => string;
  reorderNothing: string;
  status: Record<string, string>;
  instructionDefault: string;
  infoText: string;
  contactAuthor: (link: string) => string;
  contactNotSet: string;
  useMenu: string;
  /** Корзина из каталога Meta не совпала с товарами — заказ ушёл продавцу. */
  nativeCartForwarded: string;
  notReceiptLike: (no: string) => string;
  receiptPaymentFailed: (no: string) => string;
  receiptManualReview: (no: string) => string;
  receiptVerified: (no: string) => string;
  smartSearchResults: (q: string, n: number) => string;
  rateBtn: (no: string) => string;
  chooseProductToRate: string;
  chooseRatingPrompt: (name: string) => string;
  reviewSaved: string;
  reviewSkipBtn: string;
  reviewCommentSaved: string;
  reviewPhotoAdded: (n: number, max: number) => string;
  reviewPhotoLimit: (max: number) => string;
  reviewPhotoBad: string;
  reviewNotAllowed: string;
  noReviewableProducts: string;
  inviteFriendBtn: string;
  referralWelcome: (percent: number, code: string) => string;
  referralReward: (percent: number, code: string) => string;
  /** Экран «Пригласить друга»: ссылка, счётчики и коды за друзей. */
  inviteScreen: (link: string, came: number, bought: number, codes: string) => string;
  inviteCodeUsed: string;
  inviteShareBtn: string;
  cartReminder: string;
  openCartBtn: string;
  fulfillmentReminder: (no: string, date: string) => string;
  courseNewLesson: (no: number, title: string) => string;
  courseOpenBtn: string;
  /** Напоминание до старта потока (core/courses/reminders). */
  coursePreStart: (course: string, days: number, date: string) => string;
  /** Срок сдачи задания прошёл, работы нет. */
  courseHomeworkDue: (course: string, no: number, title: string) => string;
  /** Курс пройден: просьба оценить (оценка 1–5 звёздами, затем текст). */
  courseReviewAsk: (course: string) => string;
  broadcastPick: string;
  openCatalogBtn: string;
  /** Кнопка под рассылкой и ответы на отписку/возврат. */
  unsubscribeBtn: string;
  unsubscribeHint: string;
  unsubscribed: string;
  resubscribed: string;
  /** То же для Instagram/WhatsApp: там нет /start. */
  unsubscribedDirect: string;
  yourId: (id: number) => string;
  fileLink: string;
  fileLinkTtl: string;
  chooseDeliveryLanguage: string;
  allLanguagesBtn: (n: number) => string;
  chooseItemLanguage: (name: string) => string;
  fileAlreadySent: string;
};

const ru: Msg = {
  payBalanceBtn: (no) => `💳 Оплатить остаток #${no}`,
  balanceTitle: (no, sum) => `💳 <b>Остаток по заказу #${no}</b>\n\n💰 К оплате: <b>${sum}</b>`,
  balanceNoDetails: "Реквизиты для оплаты уточните у продавца.",
  balanceHowTo: (card) =>
    card
      ? "Оплатите картой по кнопке ниже — остаток отметится сам. Или переведите по реквизитам и пришлите сюда фото или PDF чека."
      : "Переведите по реквизитам и пришлите сюда фото или PDF чека.",
  balanceNotDue: "По этому заказу доплачивать нечего.",
  balanceProofWaiting: "Чек на остаток уже у продавца на проверке.",
  balanceProofReceived: (no) =>
    `✅ Чек на остаток по заказу #${no} получен. Продавец проверит его и отметит оплату.`,
  balancePaid: (no, sum) => `✅ Остаток ${sum} по заказу #${no} получен. Спасибо!`,
  balanceProofRejected: (no) =>
    `❌ Чек на остаток по заказу #${no} продавец не принял. Оплатите остаток ещё раз или пришлите другой чек; вопросы — продавцу.`,
  emailSaveFailed: "Не получилось сохранить почту. Пришлите адрес ещё раз, пожалуйста.",
  emailAsk:
    "На какую почту прислать материалы после оплаты? Instagram не умеет пересылать документы, поэтому файлы уходят письмом.\n\nПроверьте адрес: без лишних пробелов и ошибок, например anna@mail.ru",
  emailAskOptional:
    "Прислать материалы ещё и на почту? Напишите адрес, например anna@mail.ru, или нажмите «Без почты».",
  emailSkipBtn: "Без почты",
  emailHint:
    "Это не похоже на адрес почты. Напишите его целиком, например anna@mail.ru\n\nЧтобы выйти, напишите «отмена».",
  emailSaved: (email) => `Записал: ${email}. Материалы придут на этот адрес после проверки оплаты.`,
  proofReceivedEmail: (no, email) =>
    `✅ Чек по заказу #${no} получен. После проверки пришлём материалы сюда и на ${email}.`,
  proofReceivedNeedEmail: (no) =>
    `✅ Чек по заказу #${no} получен.\n\nНа какую почту прислать материалы? Instagram не умеет пересылать документы, поэтому файлы уходят письмом. Проверьте адрес перед отправкой.`,
  notReceiptLike: (no) =>
    `⚠️ Это не похоже на чек оплаты.\n\nПришлите, пожалуйста, скриншот перевода / чека с суммой заказа #${no}.`,
  receiptPaymentFailed: (no) =>
    `⚠️ По этому скриншоту платёж не прошёл (ошибка, отказ или неверные данные).\n\nЗаказ #${no} не выдан. Пришлите чек успешной оплаты — когда перевод действительно зачислится.`,
  receiptManualReview: (no) =>
    `📨 Чек по заказу #${no} получен, но автоматическая проверка не прошла. Заказ отправлен продавцу на ручную проверку — файлы придут после подтверждения.`,
  receiptVerified: (no) => `✅ Спасибо! Чек проверен. Заказ #${no} — отправляю файлы…`,
  smartSearchResults: (q, n) => `🤖 По смыслу запроса «${q}» подобрано: ${n}`,
  rateBtn: (no) => `⭐ Оценить (#${no})`,
  chooseProductToRate: "Какой товар из этого заказа оцениваете?",
  chooseRatingPrompt: (name) => `Оцените «${name}»:`,
  reviewSaved:
    "✅ Спасибо за оценку! Хотите добавить комментарий или до 3 фото — просто пришлите их.",
  reviewSkipBtn: "Пропустить",
  reviewCommentSaved: "✅ Комментарий сохранён. Спасибо за отзыв!",
  reviewPhotoAdded: (n, max) =>
    `📷 Фото добавлено (${n} из ${max}). Можно прислать ещё или написать комментарий.`,
  reviewPhotoLimit: (max) => `К отзыву можно приложить не больше ${max} фото.`,
  reviewPhotoBad: "Не получилось добавить фото: нужна картинка JPEG, PNG или WebP до 5 МБ.",
  reviewNotAllowed: "⚠️ Оценить можно только то, что вы реально купили и получили.",
  noReviewableProducts: "В этом заказе нет товаров, которые можно оценить.",
  inviteFriendBtn: "🎁 Пригласить друга",
  referralWelcome: (p, c) =>
    `🎁 Вам подарок за переход по приглашению — промокод на скидку ${p}% на первую покупку: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Ваш приглашённый друг совершил первую покупку! Промокод на скидку ${p}% для вас: <code>${c}</code>`,
  inviteScreen: (link, came, bought, codes) =>
    `🎁 <b>Пригласить друга</b>\n\nВаша личная ссылка:\n${link}\n\nПришло друзей: <b>${came}</b>\nКупили: <b>${bought}</b>\n\nКогда друг сделает первую покупку, вы получите промокод.${codes ? `\n\nВаши коды за друзей:\n${codes}` : ""}`,
  inviteCodeUsed: "использован",
  inviteShareBtn: "🎁 Поделиться ссылкой",
  cartReminder:
    "🛒 Вы оставили товары в корзине — они всё ещё вас ждут! Оформить заказ можно в любой момент.",
  openCartBtn: "🛒 Открыть корзину",
  fulfillmentReminder: (no, d) => `⏰ Напоминаем: заказ #${no} — получение завтра, ${d}.`,
  courseNewLesson: (no, title) => `📚 Открыт урок ${no}: «${title}».`,
  courseOpenBtn: "Открыть курс",
  coursePreStart: (course, days, date) =>
    `⏳ Курс «${course}» начнётся ${days === 1 ? "завтра" : `через ${days} дн.`} — ${date}. Первый урок придёт сюда.`,
  courseReviewAsk: (course) =>
    `🎓 Поздравляем с окончанием курса «${course}»! Оцените его — это займёт минуту:`,
  courseHomeworkDue: (course, no, title) =>
    `📝 Напоминаем: задание урока ${no} «${title}» курса «${course}» ещё не сдано. Пришлите ответ — преподаватель ждёт.`,
  broadcastPick: "👇 Выберите материал:",
  openCatalogBtn: "📚 Открыть каталог",
  unsubscribeBtn: "🔕 Отписаться от рассылок",
  unsubscribeHint: "Больше не хотите получать рассылки?",
  unsubscribed:
    "Вы отписались от рассылок магазина. Сообщения о ваших заказах будут приходить как раньше.\n\nВернуться — /start или напишите «подписаться».",
  resubscribed: "Вы снова подписаны на рассылки магазина.",
  unsubscribedDirect:
    "Вы отписались от рассылок магазина. Сообщения о ваших заказах будут приходить как раньше. Вернуться — напишите «подписаться».",
  chooseLanguage: "Выберите язык",
  languageSaved: "✅ Язык сохранён.",
  chooseSection: "Выберите раздел:",
  catalog: "📚 Каталог",
  search: "🔍 Поиск",
  cart: "🛒 Корзина",
  myOrders: "📋 Мои заказы",
  myCourses: "🎓 Мои курсы",
  catalogCourses: "📚 Все курсы",
  instruction: "📖 Инструкция",
  information: "ℹ️ Информация",
  catalogHeader: "📚 Выберите категорию:",
  subcategories: "Подкатегории:",
  emptyHere: "Здесь пока пусто.",
  showMore: "Показать ещё ⬇️",
  back: "⬅️ Назад",
  backToCategories: "⬅️ К категориям",
  navigation: "Навигация:",
  addToCartBtn: "🛒 В корзину",
  priceFrom: (a) => `от ${a}`,
  descPending: "Описание скоро появится.",
  outOfStockLabel: "❌ Нет в наличии",
  waitlistBtn: "🔔 Сообщить о поступлении",
  upsellHeader: "✨ С этим часто берут:",
  quizBtn: "🧩 Подобрать товар",
  ticketPrompt: "Опишите вопрос одним сообщением — передам его команде магазина.",
  payMethods: (list) =>
    `Оплатить можно так:\n${list}\n\nВыберите товар в каталоге — реквизиты покажу при оформлении заказа.`,
  ticketCreated: (no) => `📨 Обращение #${no} принято. Ответим здесь, в этом чате.`,
  ticketAppended: (no) => `📨 Добавил к обращению #${no}. Ответим здесь.`,
  ticketClosed: (no) => `✅ Обращение #${no} закрыто. Если вопрос остался — напишите снова.`,
  quizResult: "Вот что вам подойдёт:",
  quizNothing: "Точного совпадения не нашлось — загляните в каталог.",
  quizNotReady: "Подбор ещё не настроен — загляните в каталог.",
  payViaStarsBtn: (n) => `⭐ Оплатить звёздами (${n})`,
  starsInvoiceTitle: (no) => `Заказ #${no}`,
  starsInvoiceDesc: "Оплата заказа звёздами Telegram",
  starsPaymentStale: "Заказ уже оплачен или изменился — откройте «Мои заказы».",
  waitlistJoined: "Готово — напишу, как только товар снова появится.",
  backInStock: (name) => `🔔 <b>${name}</b> снова в наличии! Успейте заказать.`,
  reviewReply: (product, text) => `💬 Ответ магазина на ваш отзыв о <b>${product}</b>:\n\n${text}`,
  productNotFound: "Товар не найден или снят с продажи.",
  added: "✅ Добавлено в корзину",
  unavailable: "Товар недоступен.",
  mixedCart:
    "В одной корзине нельзя смешивать файлы и физические товары. Оформите текущую корзину или очистите её.",
  digitalLimit: "Этот материал уже в корзине.",
  outOfStock: "Больше нет в наличии.",
  cartEmpty: "🛒 Корзина пуста.",
  cartHeader: "🛒 <b>Ваша корзина</b>\n\n",
  removeItem: (n) => `❌ Убрать: ${n.slice(0, 40)}`,
  total: (a) => `\n<b>Итого: ${a}</b>`,
  checkoutBtn: "✅ Оформить заказ",
  invoiceHeader: "🧾 <b>Счёт от продавца</b>\n\n",
  invoiceFooter: "\n\nНажмите «Оформить заказ» — дальше оплата как обычно.",
  invoicePayLink: (no, url) =>
    `\n\nЗаказ №${no}. Оплатить и загрузить чек можно на странице заказа: ${url}\nПосле оплаты материалы появятся там же.`,
  clearBtn: "🗑 Очистить",
  cartCleared: "Корзина очищена.",
  promoCodeBtn: "🎟 Ввести промокод",
  removePromoBtn: "❌ Убрать промокод",
  promoCodePrompt: "Введите промокод:",
  promoCodeInvalid: "⚠️ Промокод недействителен или больше не работает.",
  promoCodeUsed:
    "⚠️ Этот промокод можно использовать только один раз — вы уже применили его в заказе.",
  discountFx:
    "⚠️ Скидку сейчас не пересчитать в валюту заказа: курс валют недоступен. Попробуйте чуть позже или оформите без скидки.",
  mixedCurrency: "В корзине товары в разных валютах — оформите их отдельными заказами.",
  minOrderBelow: (min, short) =>
    `⚠️ Минимальная сумма заказа — ${min}. Добавьте товаров ещё на ${short}.`,
  promoCodeRemoved: "Промокод убран.",
  discountLine: (a) => `🎟 Скидка по промокоду: −${a}\n`,
  pointsAsk: (n) => `🏆 У вас ${n} баллов. Списать их в счёт этого заказа?`,
  pointsInfo: (n, cur, max) =>
    `🏆 Ваши баллы: ${n} (1 балл = 1 ${cur}). В следующем заказе можно списать до ${max}% его суммы — при оформлении бот спросит.`,
  pointsNone: (percent) =>
    `🏆 Баллов пока нет. Они начисляются за выданные заказы: ${percent}% от суммы.`,
  loyaltyTierLine: (name, percent, toNext) =>
    `🏅 Ваш уровень: ${name} (${percent}% баллами)${toNext ? `. ${toNext}` : ""}\n`,
  loyaltyTierNext: (amount, name) => `До уровня «${name}» осталось ${amount}`,
  pointsYesBtn: "Да, списать",
  pointsNoBtn: "Нет, копить",
  usePointsBtn: "🏆 Списать баллы",
  removePointsBtn: "❌ Не списывать баллы",
  pointsBalanceLine: (n) => `🏆 Ваши баллы: ${n}\n`,
  pointsDiscountLine: (a) => `🏆 Оплата баллами: −${a}\n`,
  pointsFxLine: (n, a) => `   списывается баллов: ${n} = ${a}\n`,
  pointsEarned: (n) =>
    `🏆 Вам начислено ${n} баллов за покупку. Баллами можно оплатить часть следующего заказа.`,
  giftCertificateBtn: "🎫 Ввести сертификат",
  removeGiftCertificateBtn: "❌ Убрать сертификат",
  giftCertificateCodePrompt: "Введите код подарочного сертификата:",
  giftCertificateInvalid: "⚠️ Сертификат недействителен или уже использован.",
  giftRestIssued: (code, sum) =>
    `🎁 Сертификат больше суммы заказа — остаток ${sum} сохранён новым кодом:\n<code>${code}</code>\nВведите его при следующем заказе.`,
  giftCertificateRemoved: "Сертификат убран.",
  giftCertificateDiscountLine: (a) => `🎫 Сертификат: −${a}\n`,
  orderPaidByDiscounts: (no) => `🎉 Заказ #${no} полностью оплачен скидкой — файлы уже в пути.`,
  fulfillmentTypePrompt: "Как вы хотите получить заказ?",
  fulfillmentTypePickupBtn: "🚶 Самовывоз",
  fulfillmentTypeDeliveryBtn: "🚚 Доставка",
  fulfillmentDatePrompt: (d) =>
    `📅 На какую дату? Напишите в формате ДД.ММ.ГГГГ. Ближайшая возможная: ${d}.`,
  fulfillmentDateInvalid: "Не разобрал дату. Формат: ДД.ММ.ГГГГ, например 05.03.2026.",
  fulfillmentDateTooEarly: (d) => `Так быстро не успеем. Ближайшая дата: ${d}.`,
  fulfillmentSlotPrompt: "🕒 В какое время удобно?",
  approvalAskChanges: "✏️ Напишите одним сообщением, что поправить.",
  approvalChangesSent: "Передал продавцу — он свяжется с вами 🙌",
  approvalThanks: "Спасибо! Передал продавцу 🙌",
  previewBtn: "👀 Пример",
  renewBtn: "🔁 Продлить",
  subOffBtn: "Отменить подписку",
  subOffDone: "Подписка отменена — напоминаний о продлении больше не будет.",
  renewUnavailable: "Этот товар сейчас недоступен — напишите нам, подскажем.",
  birthdayAsk:
    "🎂 Когда у вас день рождения? Напишите дату, например 15.03 — поздравим с подарком.",
  birthdayInvalid: "Не разобрал дату. Напишите день и месяц, например 15.03.",
  birthdaySaved: "Запомнил 🎉 Поздравим в ваш день!",
  deliveryZonePrompt: "Выберите район доставки:",
  addressPrompt: "📍 Укажите адрес доставки одним сообщением.",
  fulfillmentNotePrompt:
    "✏️ Пожелания к заказу (надпись, аллергия, время)? Напишите или нажмите «Без комментария».",
  fulfillmentNoteSkipBtn: "Без комментария",
  outOfStockAtCheckout:
    "К сожалению, одного из товаров больше нет в наличии — мы убрали его из корзины. Проверьте корзину и оформите заново.",
  orderAcceptedOnReceipt: (no, total) =>
    `✅ Заказ #${no} принят. Оплата ${total} при получении. Мы напишем, когда будет готов.`,
  depositLine: (due, total) => `Сейчас — задаток ${due}, остаток при получении (итого ${total}).`,
  afterProofPhysical:
    "После оплаты пришлите сюда фото или PDF чека — продавец подтвердит заказ и возьмёт в работу.",
  leadTimeLabel: (days) => `⏳ Срок изготовления: ${days} дн.`,
  choosePayMethod: "Выберите способ оплаты:",
  payConsent: (offer, privacy) =>
    `Оплачивая заказ, вы принимаете ${[offer && `<a href="${offer}">условия оферты</a>`, privacy && `<a href="${privacy}">согласие на обработку персональных данных</a>`].filter(Boolean).join(" и ")}.`,
  payViaRobokassaBtn: "💳 Оплатить картой онлайн",
  payViaCryptoBtn: "₿ Оплатить криптовалютой",
  cryptoHint:
    "Откройте ссылку, выберите монету и оплатите. Заказ подтвердится сам, когда сеть подтвердит платёж.",
  cryptoUnavailable: "Оплата криптовалютой сейчас недоступна — выберите другой способ.",
  payViaStripeBtn: "🌍 Иностранной картой / PayPal",
  stripeHint:
    "Откройте ссылку и оплатите картой любой страны. Заказ подтвердится сам сразу после оплаты.",
  stripeUnavailable: "Оплата иностранной картой сейчас недоступна — выберите другой способ.",
  payManualBtn: "🧾 Перевод по реквизитам + чек",
  robokassaHint: "Нажмите кнопку, оплатите картой — после оплаты всё придёт сюда автоматически.",
  paymentReceived: (no) => `✅ Оплата по заказу #${no} получена.`,
  chooseCountry: "🌍 Выберите страну оплаты:",
  countrySaved: (n) => `✅ Страна: ${n}`,
  paymentNotConfigured: "Продавец ещё не настроил способы оплаты. Напишите ему напрямую.",
  countryNoLongerAvailable: "Этот способ оплаты больше недоступен, выберите страну заново.",
  phonePromptHtml:
    "📞 Для связи по заказу поделитесь номером телефона — нажмите кнопку ниже или введите номер вручную.",
  shareContactBtn: "📱 Поделиться номером",
  phoneInvalid: "Не похоже на номер телефона. Введите в формате +7 700 000 00 00.",
  contactSaved: "✅ Номер сохранён.",
  checkoutBusy:
    "⏳ Оформление уже выполняется. Подождите несколько секунд и проверьте сообщения бота.",
  orderCreateFailed:
    "⚠️ Не удалось оформить заказ. Попробуйте ещё раз через минуту — если не получится, напишите продавцу.",
  manualTitleNew: (no) => `🧾 <b>Заказ #${no} оформлен</b>`,
  amountToPay: (a) => `💰 К оплате: <b>${a}</b>`,
  defaultInstructions: "Реквизиты для оплаты уточните у продавца.",
  afterProofManual:
    "После оплаты пришлите сюда фото или PDF чека — продавец проверит и выдаст материалы.",
  sendReceiptPrompt:
    "Пришлите, пожалуйста, фото или PDF чека об оплате. Чтобы вернуться в меню — нажмите любую кнопку ниже.",
  proofReceived: (no) => `✅ Чек по заказу #${no} получен. Ожидайте подтверждения продавца.`,
  payReminderTitle: (no) => `⏰ <b>Заказ #${no} ждёт оплаты</b>`,
  payReminderAfter: "После оплаты пришлите сюда фото или PDF чека.",
  payReminderAmount: (a) => `💰 К оплате: <b>${a}</b>`,
  payReminderDeposit: (due, total) =>
    `Сейчас — задаток ${due}, остаток при получении (итого ${total}).`,
  payReminderNoDetails: "Реквизиты для оплаты уточните у продавца.",
  payReminderLink: (url) => `Оплатить и прислать чек можно на странице заказа:\n${url}`,
  proofDuplicate: "Этот чек уже был отправлен по другому заказу. Пришлите чек именно этой оплаты.",
  proofFailed: "Не удалось сохранить чек, попробуйте отправить ещё раз.",
  proofBadFile: "Чек нужен фотографией или PDF-файлом. Пришлите, пожалуйста, чек ещё раз.",
  proofTooLarge: "Файл чека больше 20 МБ. Пришлите, пожалуйста, скриншот или PDF поменьше.",
  proofOrderClosed: "Этот заказ уже закрыт.",
  orderDelivered: (no) => `🎉 Заказ #${no} выдан. Спасибо за покупку!`,
  orderRejected: (no) => `❌ Заказ #${no} отклонён продавцом. Если это ошибка — напишите ему.`,
  orderAccepted: (no) => `✅ Заказ #${no} принят в работу.`,
  orderRefunded: (no, full, sum) =>
    `↩️ По заказу #${no} оформлен ${full ? "возврат" : "частичный возврат"}: ${sum}.`,
  searchPrompt: "🔍 Введите слово для поиска по каталогу:",
  searchNothing: (q) => `По запросу «${q}» ничего не найдено.`,
  searchResults: (q, n) => `🔍 «${q}»: найдено ${n}`,
  searchShown: (s, t) => `Показано ${s} из ${t}`,
  searchExpired: "Сессия поиска устарела. Повторите поиск.",
  myOrdersEmpty: "У вас пока нет заказов.",
  myOrdersHeader: "📋 <b>Ваши заказы</b>\n\n",
  resendBtn: "📥 Прислать файлы ещё раз",
  reorderBtn: "🔁 Повторить заказ",
  reorderDone: (n) => `🔁 Добавил в корзину ${n} поз. из прошлого заказа`,
  reorderNothing: "Из этого заказа ничего уже нет в продаже.",
  status: {
    awaiting_payment: "ожидает оплаты",
    awaiting_confirmation: "чек на проверке",
    delivering: "выдаётся",
    delivered: "выдан",
    rejected: "отклонён",
    cancelled: "отменён",
    refunded: "деньги возвращены",
    accepted: "принят",
    in_production: "готовится",
    ready: "готов",
  },
  instructionDefault:
    "📖 Как пользоваться: каталог → корзина → оформить → оплата → чек. Файлы придут после подтверждения оплаты.",
  infoText: "ℹ️ Документы продавца:",
  contactAuthor: (l) => `💬 Связаться с продавцом: ${l}`,
  contactNotSet: "Продавец ещё не указал контакт для связи.",
  useMenu: "Выберите раздел в меню ниже 👇",
  nativeCartForwarded:
    "Получил вашу корзину из каталога и передал продавцу — он подтвердит заказ и напишет здесь.",
  yourId: (id) => `Ваш Telegram ID: <code>${id}</code>`,
  fileLink: "📥 Нажмите здесь, чтобы скачать файл",
  fileLinkTtl: "Ссылка действует 7 дней",
  chooseDeliveryLanguage: "🌐 На каком языке нужны материалы?",
  allLanguagesBtn: (n) => `Все языки ×${n}`,
  chooseItemLanguage: (name) =>
    `📚 Материал «<b>${name}</b>»\nВыберите язык, на котором хотите получить файл:`,
  fileAlreadySent: "Этот файл уже отправлен на выбранном языке.",
};

const kk: Msg = {
  ...ru,
  orderDelivered: (no) => `🎉 #${no} тапсырыс берілді. Сатып алғаныңызға рахмет!`,
  orderRejected: (no) =>
    `❌ #${no} тапсырысты сатушы қабылдамады. Егер бұл қате болса — сатушыға жазыңыз.`,
  orderAccepted: (no) => `✅ #${no} тапсырыс жұмысқа қабылданды.`,
  orderRefunded: (no, full, sum) =>
    `↩️ #${no} тапсырыс бойынша ${full ? "қайтарым" : "ішінара қайтарым"} рәсімделді: ${sum}.`,
  payConsent: (offer, privacy) =>
    `Тапсырысты төлей отырып, сіз ${[offer && `<a href="${offer}">оферта шарттарын</a>`, privacy && `<a href="${privacy}">дербес деректерді өңдеуге келісімді</a>`].filter(Boolean).join(" және ")} қабылдайсыз.`,
  payBalanceBtn: (no) => `💳 Қалғанын төлеу #${no}`,
  balanceTitle: (no, sum) =>
    `💳 <b>#${no} тапсырыс бойынша қалған сома</b>\n\n💰 Төлеуге: <b>${sum}</b>`,
  balanceNoDetails: "Төлем деректемелерін сатушыдан нақтылаңыз.",
  balanceHowTo: (card) =>
    card
      ? "Төмендегі батырма арқылы картамен төлеңіз — қалған сома өзі белгіленеді. Немесе деректемелер бойынша аударып, чектің фотосын не PDF-ін осында жіберіңіз."
      : "Деректемелер бойынша аударып, чектің фотосын не PDF-ін осында жіберіңіз.",
  balanceNotDue: "Бұл тапсырыс бойынша қосымша төлеудің қажеті жоқ.",
  balanceProofWaiting: "Қалған сомаға чек сатушыда тексеруде.",
  balanceProofReceived: (no) =>
    `✅ #${no} тапсырыс бойынша қалған сомаға чек алынды. Сатушы тексеріп, төлемді белгілейді.`,
  balancePaid: (no, sum) => `✅ #${no} тапсырыс бойынша қалған ${sum} алынды. Рақмет!`,
  balanceProofRejected: (no) =>
    `❌ #${no} тапсырыс бойынша қалған сомаға чекті сатушы қабылдамады. Қалған соманы қайта төлеңіз немесе басқа чек жіберіңіз; сұрақтар болса — сатушыға.`,
  payReminderTitle: (no) => `⏰ <b>#${no} тапсырыс төлемді күтуде</b>`,
  payReminderAfter: "Төлегеннен кейін чектің фотосын немесе PDF файлын осында жіберіңіз.",
  payReminderAmount: (a) => `💰 Төлеуге: <b>${a}</b>`,
  payReminderDeposit: (due, total) =>
    `Қазір — кепілақы ${due}, қалғаны алған кезде (барлығы ${total}).`,
  payReminderNoDetails: "Төлем деректемелерін сатушыдан нақтылаңыз.",
  payReminderLink: (url) => `Төлеуге және чекті жіберуге тапсырыс бетінде болады:\n${url}`,
  emailSaveFailed: "Поштаны сақтау мүмкін болмады. Мекенжайды қайта жіберіңізші.",
  emailAsk:
    "Төлемнен кейін материалдарды қай поштаға жіберейік? Instagram құжаттарды жібере алмайды, сондықтан файлдар хатпен кетеді.\n\nМекенжайды тексеріңіз: артық бос орынсыз және қатесіз, мысалы anna@mail.ru",
  emailAskOptional:
    "Материалдарды поштаға да жіберейік пе? Мекенжайды жазыңыз, мысалы anna@mail.ru, немесе «Поштасыз» түймесін басыңыз.",
  emailSkipBtn: "Поштасыз",
  emailHint:
    "Бұл пошта мекенжайына ұқсамайды. Толық жазыңыз, мысалы anna@mail.ru\n\nШығу үшін «болдырмау» деп жазыңыз.",
  emailSaved: (email) =>
    `Жаздым: ${email}. Төлем тексерілген соң материалдар осы мекенжайға келеді.`,
  proofReceivedEmail: (no, email) =>
    `✅ #${no} тапсырыстың чегі алынды. Тексерістен кейін материалдарды осында және ${email} мекенжайына жібереміз.`,
  proofReceivedNeedEmail: (no) =>
    `✅ #${no} тапсырыстың чегі алынды.\n\nМатериалдарды қай поштаға жіберейік? Instagram құжаттарды жібере алмайды, сондықтан файлдар хатпен кетеді. Жібермес бұрын мекенжайды тексеріңіз.`,
  waitlistBtn: "🔔 Түскенде хабарлау",
  upsellHeader: "✨ Мұнымен бірге жиі алады:",
  quizBtn: "🧩 Тауар таңдау",
  ticketPrompt: "Сұрағыңызды бір хабарламамен сипаттаңыз — дүкен командасына жеткіземін.",
  payMethods: (list) =>
    `Төлеу тәсілдері:\n${list}\n\nКаталогтан тауар таңдаңыз — деректемелерді тапсырысты рәсімдегенде көрсетемін.`,
  ticketCreated: (no) => `📨 #${no} өтініш қабылданды. Осы чатта жауап береміз.`,
  ticketAppended: (no) => `📨 #${no} өтінішке қостым. Осында жауап береміз.`,
  ticketClosed: (no) => `✅ #${no} өтініш жабылды. Сұрақ қалса — қайта жазыңыз.`,
  quizResult: "Сізге мыналар сәйкес келеді:",
  quizNothing: "Дәл сәйкестік табылмады — каталогқа қараңыз.",
  quizNotReady: "Таңдау әлі бапталмаған — каталогқа қараңыз.",
  payViaStarsBtn: (n) => `⭐ Жұлдыздармен төлеу (${n})`,
  starsInvoiceTitle: (no) => `Тапсырыс #${no}`,
  starsInvoiceDesc: "Тапсырысты Telegram жұлдыздарымен төлеу",
  starsPaymentStale:
    "Тапсырыс төленіп қойған немесе өзгерген — «Менің тапсырыстарым» бөлімін ашыңыз.",
  waitlistJoined: "Дайын — тауар қайта пайда болғанда жазамын.",
  backInStock: (name) => `🔔 <b>${name}</b> қайтадан сатылымда! Тапсырыс беріп үлгеріңіз.`,
  reviewReply: (product, text) =>
    `💬 <b>${product}</b> туралы пікіріңізге дүкеннің жауабы:\n\n${text}`,
  reorderBtn: "🔁 Тапсырысты қайталау",
  reorderDone: (n) => `🔁 Өткен тапсырыстан ${n} позиция себетке қосылды`,
  reorderNothing: "Бұл тапсырыстан ештеңе енді сатылымда жоқ.",
  notReceiptLike: (no) =>
    `⚠️ Бұл төлем чегіне ұқсамайды.\n\n#${no} тапсырысының сомасы көрсетілген аударым/чек скриншотын жіберіңіз.`,
  receiptPaymentFailed: (no) =>
    `⚠️ Бұл скриншот бойынша төлем өтпеген (қате, бас тарту немесе қате деректер).\n\n#${no} тапсырысы берілген жоқ. Аударым нақты түскеннен кейін сәтті төлем чегін жіберіңіз.`,
  receiptManualReview: (no) =>
    `📨 #${no} тапсырысы бойынша чек алынды, бірақ автоматты тексеру өтпеді. Тапсырыс сатушыға қолмен тексеруге жіберілді — файлдар растаудан кейін келеді.`,
  receiptVerified: (no) => `✅ Рақмет! Чек тексерілді. Тапсырыс #${no} — файлдарды жіберудемін…`,
  smartSearchResults: (q, n) => `🤖 «${q}» сұрауының мағынасы бойынша таңдалды: ${n}`,
  rateBtn: (no) => `⭐ Бағалау (#${no})`,
  chooseProductToRate: "Осы тапсырыстан қай тауарды бағалайсыз?",
  chooseRatingPrompt: (name) => `«${name}» тауарын бағалаңыз:`,
  reviewSaved:
    "✅ Бағалағаныңыз үшін рақмет! Пікір немесе 3 фотоға дейін қосқыңыз келсе — жай ғана жіберіңіз.",
  reviewSkipBtn: "Өткізіп жіберу",
  reviewCommentSaved: "✅ Пікір сақталды. Пікіріңіз үшін рақмет!",
  reviewPhotoAdded: (n, max) =>
    `📷 Фото қосылды (${n} / ${max}). Тағы жіберуге немесе пікір жазуға болады.`,
  reviewPhotoLimit: (max) => `Пікірге ${max} фотодан артық қосуға болмайды.`,
  reviewPhotoBad: "Фото қосылмады: 5 МБ-қа дейінгі JPEG, PNG не WebP сурет керек.",
  reviewNotAllowed: "⚠️ Тек нақты сатып алып, алған тауарды ғана бағалауға болады.",
  noReviewableProducts: "Бұл тапсырыста бағалауға болатын тауар жоқ.",
  inviteFriendBtn: "🎁 Досты шақыру",
  referralWelcome: (p, c) =>
    `🎁 Шақыру сілтемесі бойынша өткеніңіз үшін сыйлық — алғашқы сатып алуға ${p}% жеңілдік промокоды: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Сіз шақырған дос алғашқы сатып алуын жасады! Сізге ${p}% жеңілдік промокоды: <code>${c}</code>`,
  inviteScreen: (link, came, bought, codes) =>
    `🎁 <b>Досты шақыру</b>\n\nСіздің жеке сілтемеңіз:\n${link}\n\nКелген достар: <b>${came}</b>\nСатып алғандар: <b>${bought}</b>\n\nДосыңыз алғашқы сатып алуды жасағанда, сіз промокод аласыз.${codes ? `\n\nДостарыңыз үшін кодтарыңыз:\n${codes}` : ""}`,
  inviteCodeUsed: "қолданылған",
  inviteShareBtn: "🎁 Сілтемені бөлісу",
  cartReminder:
    "🛒 Себетте тауарлар қалды — олар әлі де сізді күтуде! Тапсырысты кез келген уақытта рәсімдей аласыз.",
  openCartBtn: "🛒 Себетті ашу",
  fulfillmentReminder: (no, d) => `⏰ Еске саламыз: №${no} тапсырысты алу ертең, ${d}.`,
  courseNewLesson: (no, title) => `📚 ${no}-сабақ ашылды: «${title}».`,
  courseOpenBtn: "Курсты ашу",
  coursePreStart: (course, days, date) =>
    `⏳ «${course}» курсы ${days === 1 ? "ертең" : `${days} күннен кейін`} басталады — ${date}. Бірінші сабақ осында келеді.`,
  courseReviewAsk: (course) =>
    `🎓 «${course}» курсын аяқтағаныңызбен құттықтаймыз! Оны бағалаңыз — бір минут қана:`,
  courseHomeworkDue: (course, no, title) =>
    `📝 Еске саламыз: «${course}» курсының ${no}-сабағы «${title}» тапсырмасы әлі тапсырылмаған. Жауабыңызды жіберіңіз — оқытушы күтуде.`,
  broadcastPick: "👇 Материалды таңдаңыз:",
  openCatalogBtn: "📚 Каталогты ашу",
  unsubscribeBtn: "🔕 Таратылымнан бас тарту",
  unsubscribeHint: "Таратылым алуды қаламайсыз ба?",
  unsubscribed:
    "Сіз дүкен таратылымынан бас тарттыңыз. Тапсырыстарыңыз туралы хабарлар бұрынғыдай келеді.\n\nҚайта жазылу — /start немесе «жазылу» деп жазыңыз.",
  resubscribed: "Сіз дүкен таратылымына қайта жазылдыңыз.",
  unsubscribedDirect:
    "Сіз дүкен таратылымынан бас тарттыңыз. Тапсырыстарыңыз туралы хабарлар бұрынғыдай келеді. Қайта жазылу үшін «жазылу» деп жазыңыз.",
  chooseLanguage: "Тілді таңдаңыз",
  chooseDeliveryLanguage: "🌐 Материалдарды қай тілде алғыңыз келеді?",
  allLanguagesBtn: (n) => `Барлық тілдер ×${n}`,
  chooseItemLanguage: (name) => `📚 «<b>${name}</b>» материалы\nФайлды қай тілде алғыңыз келеді:`,
  fileAlreadySent: "Бұл файл таңдалған тілде жіберілген.",
  searchPrompt: "🔍 Каталогтан іздеу үшін сөз енгізіңіз:",
  searchNothing: (q) => `«${q}» сұрауы бойынша ештеңе табылмады.`,
  searchResults: (q, n) => `🔍 «${q}»: табылды ${n}`,
  searchShown: (s, t) => `Көрсетілді ${s} / ${t}`,
  searchExpired: "Іздеу сессиясы ескірді. Іздеуді қайталаңыз.",
  languageSaved: "✅ Тіл сақталды.",
  chooseSection: "Бөлімді таңдаңыз:",
  catalog: "📚 Каталог",
  search: "🔍 Іздеу",
  cart: "🛒 Себет",
  myOrders: "📋 Тапсырыстарым",
  myCourses: "🎓 Курстарым",
  catalogCourses: "📚 Барлық курстар",
  instruction: "📖 Нұсқаулық",
  information: "ℹ️ Ақпарат",
  catalogHeader: "📚 Санатты таңдаңыз:",
  subcategories: "Ішкі санаттар:",
  emptyHere: "Әзірге бос.",
  showMore: "Тағы көрсету ⬇️",
  back: "⬅️ Артқа",
  backToCategories: "⬅️ Санаттарға",
  addToCartBtn: "🛒 Себетке",
  added: "✅ Себетке қосылды",
  cartEmpty: "🛒 Себет бос.",
  cartHeader: "🛒 <b>Сіздің себетіңіз</b>\n\n",
  total: (a) => `\n<b>Барлығы: ${a}</b>`,
  checkoutBtn: "✅ Тапсырыс беру",
  invoiceHeader: "🧾 <b>Сатушының шоты</b>\n\n",
  invoiceFooter: "\n\n«Тапсырыс беру» батырмасын басыңыз — әрі қарай төлем әдеттегідей.",
  invoicePayLink: (no, url) =>
    `\n\n№${no} тапсырыс. Төлеп, чекті тапсырыс бетінде жүктеуге болады: ${url}\nТөлемнен кейін материалдар сол жерде пайда болады.`,
  clearBtn: "🗑 Тазалау",
  promoCodeBtn: "🎟 Промокод енгізу",
  removePromoBtn: "❌ Промокодты алып тастау",
  promoCodeInvalid: "⚠️ Промокод жарамсыз немесе енді жұмыс істемейді.",
  promoCodeUsed:
    "⚠️ Бұл промокодты бір рет қана қолдануға болады — сіз оны тапсырыста қолдандыңыз.",
  discountFx:
    "⚠️ Жеңілдікті қазір тапсырыс валютасына аудару мүмкін емес: валюта бағамы қолжетімсіз. Сәл кейінірек көріңіз немесе жеңілдіксіз рәсімдеңіз.",
  mixedCurrency:
    "Себетте әртүрлі валютадағы тауарлар бар — оларды бөлек тапсырыстармен рәсімдеңіз.",
  minOrderBelow: (min, short) =>
    `⚠️ Тапсырыстың ең аз сомасы — ${min}. Тағы ${short} сомасына тауар қосыңыз.`,
  pointsAsk: (n) => `🏆 Сізде ${n} балл бар. Осы тапсырысқа жұмсаймыз ба?`,
  pointsInfo: (n, cur, max) =>
    `🏆 Сіздің ұпайларыңыз: ${n} (1 ұпай = 1 ${cur}). Келесі тапсырыста оның сомасының ${max}%-ына дейін жұмсауға болады — рәсімдеу кезінде бот сұрайды.`,
  pointsNone: (percent) =>
    `🏆 Әзірге ұпай жоқ. Ол берілген тапсырыстар үшін есептеледі: соманың ${percent}%-ы.`,
  loyaltyTierLine: (name, percent, toNext) =>
    `🏅 Сіздің деңгейіңіз: ${name} (${percent}% ұпаймен)${toNext ? `. ${toNext}` : ""}\n`,
  loyaltyTierNext: (amount, name) => `«${name}» деңгейіне дейін ${amount} қалды`,
  pointsYesBtn: "Иә, жұмсау",
  pointsNoBtn: "Жоқ, жинау",
  pointsFxLine: (n, a) => `   жұмсалатын балл: ${n} = ${a}\n`,
  usePointsBtn: "🏆 Баллдарды жұмсау",
  removePointsBtn: "❌ Баллдарды жұмсамау",
  giftCertificateBtn: "🎫 Сертификат енгізу",
  removeGiftCertificateBtn: "❌ Сертификатты алып тастау",
  giftCertificateInvalid: "⚠️ Сертификат жарамсыз немесе бұрын пайдаланылған.",
  giftRestIssued: (code, sum) =>
    `🎁 Сертификат тапсырыс сомасынан көп — қалған ${sum} жаңа кодпен сақталды:\n<code>${code}</code>\nОны келесі тапсырыста енгізіңіз.`,
  chooseCountry: "🌍 Төлем елін таңдаңыз:",
  useMenu: "Төмендегі мәзірден бөлімді таңдаңыз 👇",
  nativeCartForwarded:
    "Каталогтан жиналған себетіңізді алдым және сатушыға бердім — ол тапсырысты растап, осында жазады.",
};

const en: Msg = {
  ...ru,
  orderDelivered: (no) => `🎉 Order #${no} has been delivered. Thank you for your purchase!`,
  orderRejected: (no) =>
    `❌ Order #${no} was declined by the seller. If this is a mistake, please message them.`,
  orderAccepted: (no) => `✅ Order #${no} has been accepted and is in progress.`,
  orderRefunded: (no, full, sum) =>
    `↩️ ${full ? "A refund" : "A partial refund"} was issued for order #${no}: ${sum}.`,
  payConsent: (offer, privacy) =>
    `By paying for the order you accept ${[offer && `<a href="${offer}">the terms of the offer</a>`, privacy && `<a href="${privacy}">the personal data processing consent</a>`].filter(Boolean).join(" and ")}.`,
  renewBtn: "🔁 Renew",
  subOffBtn: "Cancel subscription",
  subOffDone: "Subscription cancelled — no more renewal reminders.",
  renewUnavailable: "This product is unavailable right now — message us and we'll help.",
  payViaStripeBtn: "🌍 Foreign card / PayPal",
  stripeHint:
    "Open the link and pay with a card from any country. The order is confirmed automatically right after payment.",
  stripeUnavailable:
    "Foreign card payment is unavailable right now — please choose another method.",
  payBalanceBtn: (no) => `💳 Pay the balance #${no}`,
  balanceTitle: (no, sum) => `💳 <b>Balance for order #${no}</b>\n\n💰 To pay: <b>${sum}</b>`,
  balanceNoDetails: "Please ask the seller for payment details.",
  balanceHowTo: (card) =>
    card
      ? "Pay by card with the button below — the balance is recorded automatically. Or pay by transfer and send a photo or PDF of the receipt here."
      : "Pay by transfer and send a photo or PDF of the receipt here.",
  balanceNotDue: "There is nothing left to pay on this order.",
  balanceProofWaiting: "Your balance receipt is already with the seller for review.",
  balanceProofReceived: (no) =>
    `✅ Balance receipt for order #${no} received. The seller will check it and record the payment.`,
  balancePaid: (no, sum) => `✅ Balance of ${sum} for order #${no} received. Thank you!`,
  balanceProofRejected: (no) =>
    `❌ The seller did not accept the balance receipt for order #${no}. Please pay the balance again or send another receipt; questions go to the seller.`,
  payReminderTitle: (no) => `⏰ <b>Order #${no} is awaiting payment</b>`,
  payReminderAfter: "After paying, send a photo or PDF of the receipt here.",
  payReminderAmount: (a) => `💰 To pay: <b>${a}</b>`,
  payReminderDeposit: (due, total) =>
    `Now — a deposit of ${due}, the rest on receipt (total ${total}).`,
  payReminderNoDetails: "Please ask the seller for payment details.",
  payReminderLink: (url) => `You can pay and send the receipt on the order page:\n${url}`,
  emailSaveFailed: "Couldn't save the email. Please send the address again.",
  emailAsk:
    "Which email should we send the materials to after payment? Instagram can't forward documents, so files go out by email.\n\nPlease check the address: no extra spaces or typos, e.g. anna@mail.ru",
  emailAskOptional:
    "Send the materials to your email as well? Type the address, e.g. anna@mail.ru, or tap “No email”.",
  emailSkipBtn: "No email",
  emailHint:
    "That doesn't look like an email address. Please type it in full, e.g. anna@mail.ru\n\nTo exit, type “cancel”.",
  emailSaved: (email) =>
    `Saved: ${email}. The materials will go to this address once payment is checked.`,
  proofReceivedEmail: (no, email) =>
    `✅ Receipt for order #${no} received. After checking we'll send the materials here and to ${email}.`,
  proofReceivedNeedEmail: (no) =>
    `✅ Receipt for order #${no} received.\n\nWhich email should we send the materials to? Instagram can't forward documents, so files go out by email. Please check the address before sending.`,
  waitlistBtn: "🔔 Notify me when available",
  upsellHeader: "✨ Often bought together:",
  quizBtn: "🧩 Find a product",
  ticketPrompt: "Describe your question in one message — I will pass it to the shop team.",
  payMethods: (list) =>
    `You can pay:\n${list}\n\nPick a product in the catalog — I will show payment details when you place the order.`,
  ticketCreated: (no) => `📨 Request #${no} received. We will reply here in this chat.`,
  ticketAppended: (no) => `📨 Added to request #${no}. We will reply here.`,
  ticketClosed: (no) =>
    `✅ Request #${no} is closed. If you still have a question, just write again.`,
  quizResult: "Here is what suits you:",
  quizNothing: "No exact match — have a look at the catalog.",
  quizNotReady: "The picker is not set up yet — have a look at the catalog.",
  payViaStarsBtn: (n) => `⭐ Pay with Stars (${n})`,
  starsInvoiceTitle: (no) => `Order #${no}`,
  starsInvoiceDesc: "Paying for the order with Telegram Stars",
  starsPaymentStale: "The order is already paid or has changed — open “My orders”.",
  waitlistJoined: "Done — I will message you as soon as it is back.",
  backInStock: (name) => `🔔 <b>${name}</b> is back in stock! Order while it lasts.`,
  reviewReply: (product, text) =>
    `💬 The shop replied to your review of <b>${product}</b>:\n\n${text}`,
  reorderBtn: "🔁 Reorder",
  reorderDone: (n) => `🔁 Added ${n} item(s) from your previous order to the cart`,
  reorderNothing: "Nothing from this order is on sale anymore.",
  notReceiptLike: (no) =>
    `⚠️ This doesn’t look like a payment receipt.\n\nPlease send a screenshot of the transfer/receipt showing the amount for order #${no}.`,
  receiptPaymentFailed: (no) =>
    `⚠️ This screenshot shows the payment did not go through (error, declined, or invalid details).\n\nOrder #${no} was not fulfilled. Please send a receipt of a successful payment once the transfer is completed.`,
  receiptManualReview: (no) =>
    `📨 Receipt received for order #${no}, but automatic verification failed. The order was sent to the seller for manual review — files will arrive after confirmation.`,
  receiptVerified: (no) => `✅ Thank you! Receipt verified. Order #${no} — sending files…`,
  smartSearchResults: (q, n) => `🤖 Picked by meaning for “${q}”: ${n}`,
  rateBtn: (no) => `⭐ Rate (#${no})`,
  chooseProductToRate: "Which product from this order are you rating?",
  chooseRatingPrompt: (name) => `Rate "${name}":`,
  reviewSaved:
    "✅ Thanks for the rating! Want to add a comment or up to 3 photos — just send them.",
  reviewSkipBtn: "Skip",
  reviewCommentSaved: "✅ Comment saved. Thanks for the review!",
  reviewPhotoAdded: (n, max) =>
    `📷 Photo added (${n} of ${max}). You can send more or write a comment.`,
  reviewPhotoLimit: (max) => `You can attach at most ${max} photos to a review.`,
  reviewPhotoBad: "Couldn't add the photo: send a JPEG, PNG or WebP image up to 5 MB.",
  reviewNotAllowed: "⚠️ You can only rate something you actually bought and received.",
  noReviewableProducts: "This order has no products you can rate.",
  inviteFriendBtn: "🎁 Invite a friend",
  referralWelcome: (p, c) =>
    `🎁 A gift for joining via an invitation — a ${p}% discount code for your first purchase: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Your invited friend made their first purchase! Here is a ${p}% discount code for you: <code>${c}</code>`,
  inviteScreen: (link, came, bought, codes) =>
    `🎁 <b>Invite a friend</b>\n\nYour personal link:\n${link}\n\nFriends joined: <b>${came}</b>\nBought: <b>${bought}</b>\n\nWhen a friend makes a first purchase, you get a promo code.${codes ? `\n\nYour codes for friends:\n${codes}` : ""}`,
  inviteCodeUsed: "used",
  inviteShareBtn: "🎁 Share the link",
  cartReminder:
    "🛒 You left some items in your cart — they're still waiting for you! You can check out anytime.",
  openCartBtn: "🛒 Open cart",
  fulfillmentReminder: (no, d) => `⏰ Reminder: order #${no} — pickup/delivery is tomorrow, ${d}.`,
  courseNewLesson: (no, title) => `📚 Lesson ${no} is open: “${title}”.`,
  courseOpenBtn: "Open the course",
  coursePreStart: (course, days, date) =>
    `⏳ The course “${course}” starts ${days === 1 ? "tomorrow" : `in ${days} days`} — ${date}. The first lesson will arrive here.`,
  courseReviewAsk: (course) =>
    `🎓 Congratulations on finishing “${course}”! Please rate it — it takes a minute:`,
  courseHomeworkDue: (course, no, title) =>
    `📝 Reminder: the homework for lesson ${no} “${title}” of “${course}” hasn't been submitted yet. Send your answer — the teacher is waiting.`,
  broadcastPick: "👇 Pick an item:",
  openCatalogBtn: "📚 Open catalog",
  unsubscribeBtn: "🔕 Unsubscribe",
  unsubscribeHint: "Don't want to receive these messages?",
  unsubscribed:
    "You have unsubscribed from the shop's mailings. Messages about your orders will still arrive.\n\nTo come back, send /start or type “subscribe”.",
  resubscribed: "You are subscribed to the shop's mailings again.",
  unsubscribedDirect:
    "You have unsubscribed from the shop's mailings. Messages about your orders will still arrive. To come back, type “subscribe”.",
  chooseLanguage: "Choose your language",
  chooseDeliveryLanguage: "🌐 Which language should the files be in?",
  allLanguagesBtn: (n) => `All languages ×${n}`,
  chooseItemLanguage: (name) => `📚 «<b>${name}</b>»\nChoose the language for the file:`,
  fileAlreadySent: "This file has already been sent in that language.",
  searchPrompt: "🔍 Type a word to search the catalog:",
  searchNothing: (q) => `Nothing found for “${q}”.`,
  searchResults: (q, n) => `🔍 “${q}”: ${n} found`,
  searchShown: (s, t) => `Showing ${s} of ${t}`,
  searchExpired: "Your search session has expired. Please search again.",
  languageSaved: "✅ Language saved.",
  chooseSection: "Choose a section:",
  catalog: "📚 Catalog",
  search: "🔍 Search",
  cart: "🛒 Cart",
  myOrders: "📋 My orders",
  myCourses: "🎓 My courses",
  catalogCourses: "📚 All courses",
  instruction: "📖 Guide",
  information: "ℹ️ Information",
  catalogHeader: "📚 Choose a category:",
  subcategories: "Subcategories:",
  emptyHere: "Nothing here yet.",
  showMore: "Show more ⬇️",
  back: "⬅️ Back",
  backToCategories: "⬅️ Categories",
  addToCartBtn: "🛒 Add to cart",
  priceFrom: (a) => `from ${a}`,
  added: "✅ Added to cart",
  cartEmpty: "🛒 Your cart is empty.",
  cartHeader: "🛒 <b>Your cart</b>\n\n",
  removeItem: (n) => `❌ Remove: ${n.slice(0, 40)}`,
  total: (a) => `\n<b>Total: ${a}</b>`,
  checkoutBtn: "✅ Checkout",
  invoiceHeader: "🧾 <b>Invoice from the seller</b>\n\n",
  invoiceFooter: "\n\nTap “Checkout” and pay as usual.",
  invoicePayLink: (no, url) =>
    `\n\nOrder #${no}. Pay and upload the receipt on the order page: ${url}\nYour materials will appear there after payment.`,
  clearBtn: "🗑 Clear",
  promoCodeBtn: "🎟 Enter promo code",
  removePromoBtn: "❌ Remove promo code",
  promoCodePrompt: "Enter your promo code:",
  promoCodeInvalid: "⚠️ This promo code is invalid or no longer works.",
  promoCodeUsed:
    "⚠️ This promo code can be used only once, and you have already used it in an order.",
  discountFx:
    "⚠️ The discount can't be converted to the order currency right now: exchange rates are unavailable. Try again a bit later or order without the discount.",
  mixedCurrency: "Your cart has items in different currencies — please order them separately.",
  minOrderBelow: (min, short) => `⚠️ The minimum order is ${min}. Add ${short} more to your cart.`,
  promoCodeRemoved: "Promo code removed.",
  discountLine: (a) => `🎟 Promo discount: −${a}\n`,
  pointsAsk: (n) => `🏆 You have ${n} points. Use them for this order?`,
  pointsInfo: (n, cur, max) =>
    `🏆 Your points: ${n} (1 point = 1 ${cur}). On your next order you can spend up to ${max}% of its total — the bot will ask at checkout.`,
  pointsNone: (percent) =>
    `🏆 You have no points yet. They are earned on delivered orders: ${percent}% of the total.`,
  loyaltyTierLine: (name, percent, toNext) =>
    `🏅 Your level: ${name} (${percent}% in points)${toNext ? `. ${toNext}` : ""}\n`,
  loyaltyTierNext: (amount, name) => `${amount} left to the “${name}” level`,
  pointsYesBtn: "Yes, use",
  pointsNoBtn: "No, keep",
  usePointsBtn: "🏆 Use points",
  removePointsBtn: "❌ Don't use points",
  pointsBalanceLine: (n) => `🏆 Your points: ${n}\n`,
  pointsDiscountLine: (a) => `🏆 Paid with points: −${a}\n`,
  pointsFxLine: (n, a) => `   points used: ${n} = ${a}\n`,
  pointsEarned: (n) => `🏆 You earned ${n} points. Use them on your next order.`,
  giftCertificateBtn: "🎫 Enter certificate code",
  removeGiftCertificateBtn: "❌ Remove certificate",
  giftCertificateCodePrompt: "Enter your gift certificate code:",
  giftCertificateInvalid: "⚠️ This certificate is invalid or already used.",
  giftRestIssued: (code, sum) =>
    `🎁 The certificate exceeds the order total — the remaining ${sum} is saved as a new code:\n<code>${code}</code>\nEnter it with your next order.`,
  giftCertificateRemoved: "Certificate removed.",
  giftCertificateDiscountLine: (a) => `🎫 Certificate: −${a}\n`,
  orderPaidByDiscounts: (no) =>
    `🎉 Order #${no} is fully covered by your discounts — files are on the way.`,
  chooseCountry: "🌍 Choose your payment country:",
  phonePromptHtml:
    "📞 Share your phone number for order updates — tap the button below or type it.",
  shareContactBtn: "📱 Share number",
  afterProofManual:
    "After paying, send a photo or PDF of the receipt here — the seller will confirm and deliver.",
  sendReceiptPrompt:
    "Please send a photo or PDF of your payment receipt. Tap any menu button to go back.",
  useMenu: "Pick a section from the menu below 👇",
  nativeCartForwarded:
    "Got your cart from the catalog and passed it to the seller — they will confirm the order and reply here.",
};

const uz: Msg = {
  ...ru,
  orderDelivered: (no) => `🎉 #${no}-buyurtma topshirildi. Xaridingiz uchun rahmat!`,
  orderRejected: (no) =>
    `❌ #${no}-buyurtma sotuvchi tomonidan rad etildi. Agar bu xato bo'lsa, sotuvchiga yozing.`,
  orderAccepted: (no) => `✅ #${no}-buyurtma ishga qabul qilindi.`,
  orderRefunded: (no, full, sum) =>
    `↩️ #${no}-buyurtma bo'yicha ${full ? "pulni qaytarish" : "qisman qaytarish"} rasmiylashtirildi: ${sum}.`,
  payConsent: (offer, privacy) =>
    `Buyurtma uchun to‘lab, siz ${[offer && `<a href="${offer}">oferta shartlarini</a>`, privacy && `<a href="${privacy}">shaxsiy ma’lumotlarni qayta ishlashga rozilikni</a>`].filter(Boolean).join(" va ")} qabul qilasiz.`,
  payBalanceBtn: (no) => `💳 Qolganini to‘lash #${no}`,
  balanceTitle: (no, sum) =>
    `💳 <b>#${no} buyurtma bo‘yicha qolgan summa</b>\n\n💰 To‘lov: <b>${sum}</b>`,
  balanceNoDetails: "To‘lov rekvizitlarini sotuvchidan aniqlang.",
  balanceHowTo: (card) =>
    card
      ? "Quyidagi tugma orqali karta bilan to‘lang — qolgan summa o‘zi belgilanadi. Yoki rekvizitlar bo‘yicha o‘tkazib, chek surati yoki PDF faylini shu yerga yuboring."
      : "Rekvizitlar bo‘yicha o‘tkazib, chek surati yoki PDF faylini shu yerga yuboring.",
  balanceNotDue: "Bu buyurtma bo‘yicha to‘lanadigan qoldiq yo‘q.",
  balanceProofWaiting: "Qolgan summa cheki allaqachon sotuvchida tekshiruvda.",
  balanceProofReceived: (no) =>
    `✅ #${no} buyurtma bo‘yicha qolgan summa cheki qabul qilindi. Sotuvchi tekshirib, to‘lovni belgilaydi.`,
  balancePaid: (no, sum) => `✅ #${no} buyurtma bo‘yicha qolgan ${sum} qabul qilindi. Rahmat!`,
  balanceProofRejected: (no) =>
    `❌ #${no} buyurtma bo‘yicha qolgan summa chekini sotuvchi qabul qilmadi. Qolgan summani qayta to‘lang yoki boshqa chek yuboring; savollar — sotuvchiga.`,
  payReminderTitle: (no) => `⏰ <b>#${no} buyurtma to‘lovni kutmoqda</b>`,
  payReminderAfter: "To‘lovdan so‘ng chekning surati yoki PDF faylini shu yerga yuboring.",
  payReminderAmount: (a) => `💰 To‘lov: <b>${a}</b>`,
  payReminderDeposit: (due, total) => `Hozir — zaklad ${due}, qolgani olishda (jami ${total}).`,
  payReminderNoDetails: "To‘lov rekvizitlarini sotuvchidan aniqlang.",
  payReminderLink: (url) => `To‘lash va chekni yuborish buyurtma sahifasida:\n${url}`,
  emailSaveFailed: "Pochtani saqlab bo‘lmadi. Iltimos, manzilni qayta yuboring.",
  emailAsk:
    "To‘lovdan keyin materiallarni qaysi pochtaga yuboraylik? Instagram hujjatlarni yubora olmaydi, shuning uchun fayllar xat orqali ketadi.\n\nManzilni tekshiring: ortiqcha bo‘shliq va xatosiz, masalan anna@mail.ru",
  emailAskOptional:
    "Materiallarni pochtaga ham yuboraylikmi? Manzilni yozing, masalan anna@mail.ru, yoki «Pochtasiz» tugmasini bosing.",
  emailSkipBtn: "Pochtasiz",
  emailHint:
    "Bu pochta manziliga o‘xshamaydi. To‘liq yozing, masalan anna@mail.ru\n\nChiqish uchun «bekor» deb yozing.",
  emailSaved: (email) =>
    `Yozib oldim: ${email}. To‘lov tekshirilgach materiallar shu manzilga keladi.`,
  proofReceivedEmail: (no, email) =>
    `✅ #${no} buyurtma cheki qabul qilindi. Tekshirgach materiallarni shu yerga va ${email} manziliga yuboramiz.`,
  proofReceivedNeedEmail: (no) =>
    `✅ #${no} buyurtma cheki qabul qilindi.\n\nMateriallarni qaysi pochtaga yuboraylik? Instagram hujjatlarni yubora olmaydi, shuning uchun fayllar xat orqali ketadi. Yuborishdan oldin manzilni tekshiring.`,
  waitlistBtn: "🔔 Kelganda xabar berish",
  upsellHeader: "✨ Bu bilan ko‘pincha olishadi:",
  quizBtn: "🧩 Mahsulot tanlash",
  ticketPrompt: "Savolingizni bitta xabarda yozing — do‘kon jamoasiga yetkazaman.",
  payMethods: (list) =>
    `To‘lov usullari:\n${list}\n\nKatalogdan mahsulot tanlang — rekvizitlarni buyurtma rasmiylashtirilganda ko‘rsataman.`,
  ticketCreated: (no) => `📨 #${no} murojaat qabul qilindi. Shu chatda javob beramiz.`,
  ticketAppended: (no) => `📨 #${no} murojaatga qo‘shdim. Shu yerda javob beramiz.`,
  ticketClosed: (no) => `✅ #${no} murojaat yopildi. Savol qolsa — yana yozing.`,
  quizResult: "Sizga mos keladiganlari:",
  quizNothing: "Aniq moslik topilmadi — katalogga qarang.",
  quizNotReady: "Tanlash hali sozlanmagan — katalogga qarang.",
  payViaStarsBtn: (n) => `⭐ Yulduzlar bilan to‘lash (${n})`,
  starsInvoiceTitle: (no) => `Buyurtma #${no}`,
  starsInvoiceDesc: "Buyurtmani Telegram yulduzlari bilan to‘lash",
  starsPaymentStale: "Buyurtma allaqachon to‘langan yoki o‘zgargan — «Buyurtmalarim»ni oching.",
  waitlistJoined: "Tayyor — mahsulot yana paydo bo‘lishi bilan yozaman.",
  backInStock: (name) => `🔔 <b>${name}</b> yana sotuvda! Buyurtma berishga ulguring.`,
  reviewReply: (product, text) =>
    `💬 Doʻkonning <b>${product}</b> haqidagi sharhingizga javobi:\n\n${text}`,
  reorderBtn: "🔁 Buyurtmani takrorlash",
  reorderDone: (n) => `🔁 Oldingi buyurtmadan ${n} pozitsiya savatga qo‘shildi`,
  reorderNothing: "Bu buyurtmadan hech narsa endi sotuvda yo‘q.",
  notReceiptLike: (no) =>
    `⚠️ Bu to‘lov chekiga o‘xshamayapti.\n\n#${no} buyurtma summasi ko‘rsatilgan o‘tkazma/chek skrinshotini yuboring.`,
  receiptPaymentFailed: (no) =>
    `⚠️ Bu skrinshotda to‘lov o‘tmagan (xato, rad etilgan yoki noto‘g‘ri ma’lumot).\n\n#${no} buyurtma berilmadi. O‘tkazma haqiqatan o‘tgach, muvaffaqiyatli to‘lov chekini yuboring.`,
  receiptManualReview: (no) =>
    `📨 #${no} buyurtmasi uchun chek qabul qilindi, lekin avtomatik tekshiruv o‘tmadi. Buyurtma sotuvchiga qo‘lda tekshirish uchun yuborildi — fayllar tasdiqlangandan so‘ng keladi.`,
  receiptVerified: (no) => `✅ Rahmat! Chek tekshirildi. Buyurtma #${no} — fayllar yuborilmoqda…`,
  smartSearchResults: (q, n) => `🤖 «${q}» so‘rovi ma’nosi bo‘yicha tanlandi: ${n}`,
  rateBtn: (no) => `⭐ Baholash (#${no})`,
  chooseProductToRate: "Ushbu buyurtmadan qaysi mahsulotni baholaysiz?",
  chooseRatingPrompt: (name) => `«${name}» mahsulotini baholang:`,
  reviewSaved:
    "✅ Baholaganingiz uchun rahmat! Izoh yoki 3 tagacha rasm qo‘shmoqchi bo‘lsangiz — shunchaki yuboring.",
  reviewSkipBtn: "O‘tkazib yuborish",
  reviewCommentSaved: "✅ Izoh saqlandi. Fikringiz uchun rahmat!",
  reviewPhotoAdded: (n, max) =>
    `📷 Rasm qo‘shildi (${n} / ${max}). Yana yuborish yoki izoh yozish mumkin.`,
  reviewPhotoLimit: (max) => `Fikrga ${max} tadan ortiq rasm qo‘shib bo‘lmaydi.`,
  reviewPhotoBad: "Rasm qo‘shilmadi: 5 MB gacha JPEG, PNG yoki WebP rasm kerak.",
  reviewNotAllowed: "⚠️ Faqat haqiqatan sotib olib, qo‘lga kiritgan mahsulotni baholash mumkin.",
  noReviewableProducts: "Bu buyurtmada baholash mumkin bo‘lgan mahsulot yo‘q.",
  inviteFriendBtn: "🎁 Do‘stni taklif qilish",
  referralWelcome: (p, c) =>
    `🎁 Taklif havolasi orqali o‘tganingiz uchun sovg‘a — birinchi xaridga ${p}% chegirma promokodi: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Siz taklif qilgan do‘stingiz birinchi xaridini qildi! Sizga ${p}% chegirma promokodi: <code>${c}</code>`,
  inviteScreen: (link, came, bought, codes) =>
    `🎁 <b>Do‘stni taklif qilish</b>\n\nShaxsiy havolangiz:\n${link}\n\nKelgan do‘stlar: <b>${came}</b>\nXarid qilganlar: <b>${bought}</b>\n\nDo‘stingiz birinchi xaridni qilganda, siz promokod olasiz.${codes ? `\n\nDo‘stlar uchun kodlaringiz:\n${codes}` : ""}`,
  inviteCodeUsed: "ishlatilgan",
  inviteShareBtn: "🎁 Havolani ulashish",
  cartReminder:
    "🛒 Savatda mahsulotlar qoldi — ular hali ham sizni kutmoqda! Buyurtmani istalgan vaqtda rasmiylashtirishingiz mumkin.",
  openCartBtn: "🛒 Savatni ochish",
  fulfillmentReminder: (no, d) => `⏰ Eslatma: #${no} buyurtma ertaga, ${d} kuni olinadi.`,
  courseNewLesson: (no, title) => `📚 ${no}-dars ochildi: «${title}».`,
  courseOpenBtn: "Kursni ochish",
  coursePreStart: (course, days, date) =>
    `⏳ «${course}» kursi ${days === 1 ? "ertaga" : `${days} kundan keyin`} boshlanadi — ${date}. Birinchi dars shu yerga keladi.`,
  courseReviewAsk: (course) =>
    `🎓 «${course}» kursini tugatganingiz bilan tabriklaymiz! Uni baholang — bir daqiqa kifoya:`,
  courseHomeworkDue: (course, no, title) =>
    `📝 Eslatma: «${course}» kursining ${no}-darsi «${title}» vazifasi hali topshirilmagan. Javobingizni yuboring — o‘qituvchi kutmoqda.`,
  broadcastPick: "👇 Materialni tanlang:",
  openCatalogBtn: "📚 Katalogni ochish",
  unsubscribeBtn: "🔕 Obunani bekor qilish",
  unsubscribeHint: "Xabarnomalarni olishni istamaysizmi?",
  unsubscribed:
    "Siz do'kon xabarnomalaridan obunani bekor qildingiz. Buyurtmalaringiz haqidagi xabarlar avvalgidek keladi.\n\nQaytish uchun /start yuboring yoki «obuna» deb yozing.",
  resubscribed: "Siz do'kon xabarnomalariga qayta obuna bo'ldingiz.",
  unsubscribedDirect:
    "Siz do'kon xabarnomalaridan obunani bekor qildingiz. Buyurtmalaringiz haqidagi xabarlar avvalgidek keladi. Qaytish uchun «obuna» deb yozing.",
  chooseLanguage: "Tilni tanlang",
  chooseDeliveryLanguage: "🌐 Materiallarni qaysi tilda olishni xohlaysiz?",
  allLanguagesBtn: (n) => `Barcha tillar ×${n}`,
  chooseItemLanguage: (name) => `📚 «<b>${name}</b>»\nFaylni qaysi tilda olishni tanlang:`,
  fileAlreadySent: "Bu fayl tanlangan tilda allaqachon yuborilgan.",
  searchPrompt: "🔍 Katalogdan qidirish uchun soʻz kiriting:",
  searchNothing: (q) => `«${q}» soʻrovi boʻyicha hech narsa topilmadi.`,
  searchResults: (q, n) => `🔍 «${q}»: ${n} ta topildi`,
  searchShown: (s, t) => `Koʻrsatildi ${s} / ${t}`,
  searchExpired: "Qidiruv sessiyasi eskirdi. Qayta qidiring.",
  languageSaved: "✅ Til saqlandi.",
  chooseSection: "Bo‘limni tanlang:",
  catalog: "📚 Katalog",
  search: "🔍 Qidirish",
  cart: "🛒 Savat",
  myOrders: "📋 Buyurtmalarim",
  myCourses: "🎓 Kurslarim",
  catalogCourses: "📚 Barcha kurslar",
  instruction: "📖 Yo‘riqnoma",
  information: "ℹ️ Ma’lumot",
  catalogHeader: "📚 Kategoriyani tanlang:",
  addToCartBtn: "🛒 Savatga",
  added: "✅ Savatga qo‘shildi",
  cartEmpty: "🛒 Savat bo‘sh.",
  total: (a) => `\n<b>Jami: ${a}</b>`,
  checkoutBtn: "✅ Buyurtma berish",
  invoiceHeader: "🧾 <b>Sotuvchidan hisob</b>\n\n",
  invoiceFooter: "\n\n«Buyurtma berish» tugmasini bosing — keyin toʻlov odatdagidek.",
  invoicePayLink: (no, url) =>
    `\n\nBuyurtma №${no}. Toʻlash va chekni buyurtma sahifasida yuklash mumkin: ${url}\nToʻlovdan soʻng materiallar oʻsha yerda paydo boʻladi.`,
  clearBtn: "🗑 Tozalash",
  promoCodeBtn: "🎟 Promokod kiritish",
  removePromoBtn: "❌ Promokodni olib tashlash",
  promoCodeInvalid: "⚠️ Promokod amal qilmaydi yoki endi ishlamaydi.",
  promoCodeUsed:
    "⚠️ Bu promokodni faqat bir marta ishlatish mumkin — siz uni buyurtmada qo‘llagansiz.",
  discountFx:
    "⚠️ Chegirmani hozir buyurtma valyutasiga o‘tkazib bo‘lmaydi: valyuta kursi mavjud emas. Birozdan keyin urinib ko‘ring yoki chegirmasiz rasmiylashtiring.",
  mixedCurrency: "Savatda turli valyutadagi tovarlar bor — ularni alohida buyurtma qiling.",
  minOrderBelow: (min, short) =>
    `⚠️ Buyurtmaning minimal summasi — ${min}. Savatga yana ${short} miqdorida mahsulot qoʻshing.`,
  giftRestIssued: (code, sum) =>
    `🎁 Sertifikat buyurtma summasidan ko‘p — qolgan ${sum} yangi kod bilan saqlandi:\n<code>${code}</code>\nUni keyingi buyurtmada kiriting.`,
  pointsAsk: (n) => `🏆 Sizda ${n} ball bor. Ushbu buyurtma uchun sarflaymizmi?`,
  pointsInfo: (n, cur, max) =>
    `🏆 Sizning ballaringiz: ${n} (1 ball = 1 ${cur}). Keyingi buyurtmada uning summasining ${max}% igacha sarflash mumkin — rasmiylashtirishda bot so‘raydi.`,
  pointsNone: (percent) =>
    `🏆 Hozircha ball yo‘q. Ular topshirilgan buyurtmalar uchun hisoblanadi: summaning ${percent}%.`,
  loyaltyTierLine: (name, percent, toNext) =>
    `🏅 Sizning darajangiz: ${name} (${percent}% ball bilan)${toNext ? `. ${toNext}` : ""}\n`,
  loyaltyTierNext: (amount, name) => `«${name}» darajasigacha ${amount} qoldi`,
  pointsYesBtn: "Ha, sarflash",
  pointsNoBtn: "Yo'q, jamlash",
  pointsFxLine: (n, a) => `   sarflanadigan ball: ${n} = ${a}\n`,
  usePointsBtn: "🏆 Ballarni sarflash",
  removePointsBtn: "❌ Ballarni sarflamaslik",
  giftCertificateBtn: "🎫 Sertifikat kodini kiritish",
  removeGiftCertificateBtn: "❌ Sertifikatni olib tashlash",
  useMenu: "Quyidagi menyudan bo‘limni tanlang 👇",
  nativeCartForwarded:
    "Katalogdan yig‘ilgan savatingizni oldim va sotuvchiga uzatdim — u buyurtmani tasdiqlab, shu yerda yozadi.",
};

export const COPY: Record<Locale, Msg> = { ru, kk, en, uz };

/** «Минимальная сумма заказа — …, добавьте ещё на …» — одним текстом для бота и Instagram/WhatsApp. */
export function minOrderText(
  m: Pick<Msg, "minOrderBelow">,
  below: { min: number; shortfall: number; currency: string },
): string {
  return m.minOrderBelow(
    formatMoney(below.min, below.currency),
    formatMoney(below.shortfall, below.currency),
  );
}

export type MenuAction =
  | "catalog"
  | "search"
  | "cart"
  | "myOrders"
  | "myCourses"
  | "instruction"
  | "information"
  | "invite"
  | "contact"
  | "quiz";

/** Текст кнопки меню на любом языке → каноническое действие. */
export function menuActionFor(
  text: string | undefined,
  contactLabels: string[],
): MenuAction | undefined {
  if (!text) return undefined;
  const t = text.trim();
  for (const m of Object.values(COPY)) {
    if (t === m.catalog || t === m.catalogCourses) return "catalog";
    if (t === m.search) return "search";
    if (t === m.cart) return "cart";
    if (t === m.myOrders) return "myOrders";
    if (t === m.myCourses) return "myCourses";
    if (t === m.instruction) return "instruction";
    if (t === m.information) return "information";
    if (t === m.inviteFriendBtn) return "invite";
    if (t === m.quizBtn) return "quiz";
  }
  if (contactLabels.includes(t)) return "contact";
  return undefined;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function categoryButtonLabel(name: string): string {
  const trimmed = name.trim();
  if (/^(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.test(trimmed)) return trimmed;
  return `📁 ${trimmed}`;
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  const cleaned = digits.startsWith("+") ? "+" + digits.slice(1).replace(/\+/g, "") : digits;
  const n = cleaned.replace(/\D/g, "");
  if (n.length < 10 || n.length > 15) return null;
  return cleaned.startsWith("+") ? cleaned : `+${n}`;
}
