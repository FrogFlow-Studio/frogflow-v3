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
  /** Direct: на список ответили словами, а не номером (один раз). */
  listNumberHint: string;
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
  /** Просьба оценить после закрытия: в Telegram — кнопки 1–5, в Direct/WhatsApp — ответ цифрой. */
  ticketRateTg: string;
  ticketRateDm: string;
  ticketRateThanks: (score: number) => string;
  ticketRateAlready: string;
  /** «Мои обращения» покупателя. */
  myTicketsBtn: string;
  /** Кнопка Mini App витрины в нижнем меню и у поля ввода. */
  shopAppBtn: string;
  myTicketsTitle: string;
  myTicketsEmpty: string;
  ticketStatus: (s: "open" | "waiting" | "closed") => string;
  myTicketsMore: (n: number) => string;
  myTicketsAppendBtn: string;
  myTicketsAppendHint: string;
  quizResult: string;
  quizNothing: string;
  quizNotReady: string;
  /** Instagram/WhatsApp: подсказка под вопросом и подпись кнопки списка (до 20 символов). */
  quizDirectHint: string;
  quizPick: string;
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
  /** «Это подарок» (модуль bundles): кнопка корзины, шаги получателя и открытки, строка корзины. */
  giftBtn: string;
  removeGiftBtn: string;
  giftRecipientPrompt: string;
  giftMessagePrompt: string;
  giftSkipBtn: string;
  /** Instagram/WhatsApp: «это подарок?» перед оформлением. */
  giftAsk: string;
  giftYesBtn: string;
  giftNoBtn: string;
  giftCartLine: (recipient: string, message: string) => string;
  /** Имя или открытка длиннее предела: сохранено первое. */
  giftTruncatedNote: (max: number) => string;
  /** Подарочная упаковка (модуль bundles): кнопки корзины, строка суммы, вопрос в Direct. */
  giftWrapBtn: (price: string) => string;
  removeGiftWrapBtn: string;
  giftWrapLine: (price: string) => string;
  giftWrapAsk: (price: string) => string;
  giftWrapYesBtn: string;
  giftWrapNoBtn: string;
  giftWrapUnavailable: string;
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
  /** Выбранный день нерабочий: покупателю — ближайшая рабочая дата. */
  fulfillmentDateClosed: (nextDate: string) => string;
  /** Лимит заказов: на дату всё разобрано; ближайшая свободная дата или null. */
  fulfillmentDateFull: (nextDate: string | null) => string;
  /** Выбранный слот занят. */
  fulfillmentSlotFull: string;
  /** Пока оформлялся заказ, место разобрали (день / слот). */
  orderDayTaken: string;
  orderSlotTaken: string;
  /** Строка под вопросом о дате: когда выдачи нет (дни недели и даты). */
  fulfillmentClosedNote: (list: string) => string;
  deliveryZonePrompt: string;
  /** Бесплатная доставка от суммы (core/fulfillment/free-delivery): сколько добрать / уже бесплатно / слово у зоны. */
  freeDeliveryLeft: (left: string, from: string) => string;
  freeDeliveryReached: (from: string) => string;
  freeWord: string;
  addressPrompt: string;
  fulfillmentNotePrompt: string;
  fulfillmentNoteSkipBtn: string;
  outOfStockAtCheckout: string;
  orderAcceptedOnReceipt: (no: number, total: string) => string;
  depositLine: (due: string, total: string) => string;
  afterProofPhysical: string;
  leadTimeLabel: (days: number) => string;
  /** «Осталось мало»: точный остаток, только если продавец разрешил показывать (core/catalog/low-stock). */
  lowStockLabel: (n: number) => string;
  /** Товара нет, но продавец берёт предзаказ (core/preorder); from — дата отправки (ГГГГ-ММ-ДД) или null. */
  preorderLabel: (from: string | null) => string;
  preorderCartNote: (from: string | null) => string;
  /** Продавец перенёс срок предзаказа: покупателю с открытым заказом на этот товар. */
  preorderMoved: (name: string, from: string | null) => string;
  choosePayMethod: string;
  /** Выбор оплаты с названиями кнопок словами (в переписке кнопки не всегда замечают). */
  choosePayMethodNamed: (labels: string[]) => string;
  /** Непонятная реплика, пока способ оплаты не выбран: не «пришлите чек». */
  choosePayHint: string;
  payLinkAboveHint: string;
  /** Instagram/WhatsApp: просьба прислать чек — без «нажмите кнопку ниже», под ней кнопок нет (заказ #93 Копилки). */
  dmReceiptPrompt: string;
  payLinkAsText: (url: string) => string;
  /** Оплата — акцепт оферты; ссылки на опубликованные документы. */
  payConsent: (offer: string | null, privacy: string | null) => string;
  payViaRobokassaBtn: string;
  payViaCryptoBtn: string;
  cryptoHint: string;
  cryptoUnavailable: string;
  payViaStripeBtn: string;
  stripeHint: string;
  stripeUnavailable: string;
  payViaKaspiApipayBtn: string;
  kaspiApipayHint: string;
  kaspiApipayUnavailable: string;
  /** Продамус: карта российского банка или СБП. */
  payViaProdamusBtn: string;
  prodamusHint: string;
  /** Заказ в рублях, форма Продамуса в тенге (*.kz): форма покажет тенге, банк спишет рубли. */
  prodamusRubViaKztHint: string;
  /** «490 ₽ (в форме — 1750 ₸)»: сумма, которую покажет форма. */
  prodamusFormSum: (sum: string) => string;
  payManualBtn: string;
  /** Ручной способ, в реквизитах которого есть Kaspi. */
  payKaspiBtn: string;
  /** Кнопка-ссылка на оплату из реквизитов продавца (Instagram: ссылка в тексте не всегда нажимается). */
  payLinkBtn: (kaspi: boolean) => string;
  /** Подсказка под реквизитами со ссылкой. */
  payLinkHint: string;
  /** Покупатель не может оплатить предложенным способом — вопрос ушёл продавцу. */
  payTroubleHandoff: string;
  /** Продамус с кассой не в рублях (форма KZ): карта любого банка, без «РФ / СБП». */
  payByCardBtn: string;
  /** Под выбором оплаты, касса Продамуса не в рублях: карта РФ тоже подходит. */
  cardAnyCountryLine: string;
  prodamusCardHint: string;
  robokassaHint: string;
  paymentReceived: (no: number) => string;
  chooseCountry: string;
  /** Шаг оплаты при ценах во всех валютах: у каждой страны сумма корзины. */
  choosePayCountry: string;
  countrySaved: (name: string) => string;
  paymentNotConfigured: string;
  countryNoLongerAvailable: string;
  phonePromptHtml: string;
  shareContactBtn: string;
  phoneInvalid: string;
  contactSaved: string;
  /** Номер, присланный вне шага «жду телефон»: записали как контакт, кодов товаров в нём нет. */
  phoneNoted: string;
  /** Вход на витрину по коду (В5): код покупателю в бот. */
  loginCodeMsg: (code: string, minutes: number) => string;
  /** Код на ту же ссылку просят слишком часто. */
  loginCodeWait: string;
  /** Ссылка входа не распознана или устарела. */
  loginCodeBad: string;
  checkoutBusy: string;
  orderCreateFailed: string;
  manualTitleNew: (no: number) => string;
  amountToPay: (amount: string) => string;
  defaultInstructions: string;
  afterProofManual: string;
  sendReceiptPrompt: string;
  /** «Не знаю как», «как отправить чек»: как приложить скриншот в Direct/WhatsApp. */
  receiptHowTo: string;
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
  /** Ответ на фото или скриншот вместо адреса почты (AATeach 11.10). */
  emailTextOnly: string;
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
  /** Смена статуса физического заказа продавцом: готовится, готов, выдан, принят. */
  orderStatusNotice: (status: string, no: number) => string;
  /** Продавец нажал «Отправлен» у физического заказа. */
  orderShipped: (no: number) => string;
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
  /** Что из прошлого заказа не нашлось или стало меньше: «Название» или «Название (2 из 3)». */
  reorderShort: (items: string[]) => string;
  /** «Повторить» без оплаченного заказа в прошлом. */
  reorderNoPaid: string;
  status: Record<string, string>;
  instructionDefault: string;
  infoText: string;
  contactAuthor: (link: string) => string;
  contactNotSet: string;
  useMenu: string;
  /** «+» в Direct, а первого сообщения ни одного правила этому человеку не было. */
  plusWhichProduct: string;
  /** Корзина из каталога Meta не совпала с товарами — заказ ушёл продавцу. */
  nativeCartForwarded: string;
  /** Выдача ссылками в Direct и WhatsApp (channels/zernio/deliver). */
  deliveryLinksExpire: string;
  /** Кнопка-ссылка на файл в Instagram Direct (до 20 знаков). */
  downloadBtn: string;
  deliveryOrderPage: string;
  notReceiptLike: (no: string) => string;
  receiptPaymentFailed: (no: string) => string;
  receiptManualReview: (no: string) => string;
  receiptVerified: (no: string) => string;
  /** Ответ на благодарность после выдачи заказа (Direct, ИИ после оплаты). */
  thanksReply: string;
  /** Оплата из страны, для которой у магазина нет способа оплаты (Direct, core/inbox/triage). */
  foreignPayReply: string;
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
  /** Просьба об оценке после выдачи (core/reviews/ask): Telegram, один товар; имя уже экранировано. */
  reviewAskOne: (name: string) => string;
  /** То же, несколько товаров: кнопка «Оценить» ведёт к выбору. */
  reviewAskOrder: (no: string) => string;
  /** Instagram и WhatsApp: ответ цифрой от 1 до 5, обычный текст. */
  reviewAskDirect: (name: string) => string;
  ratingThanks: string;
  inviteFriendBtn: string;
  infoOfferBtn: string;
  infoPrivacyBtn: string;
  infoRequisitesBtn: string;
  infoAboutBtn: string;
  /** Кнопка под личным ответом на комментарий (Comment-to-DM): Instagram режет подпись до 20 знаков. */
  openTelegramBtn: string;
  referralWelcome: (percent: number, code: string) => string;
  referralReward: (percent: number, code: string) => string;
  /** Экран «Пригласить друга»: ссылка, счётчики и коды за друзей. */
  inviteScreen: (link: string, came: number, bought: number, codes: string) => string;
  inviteCodeUsed: string;
  inviteShareBtn: string;
  /** Напоминание о корзине: до трёх позиций, «и ещё N» и сумма (если валюта одна). */
  cartReminderItems: (items: string, more: number, total: string | null) => string;
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
  /** Напоминания об эфире потока (core/courses/live-remind): время в поясе магазина уже в строке. */
  courseLiveDay: (course: string, title: string, when: string) => string;
  courseLiveHour: (course: string, title: string, when: string) => string;
  courseLiveJoinBtn: string;
  /** «Запись эфира готова» (Ш4). */
  courseLiveRec: (course: string, title: string, when: string) => string;
  courseLiveWatchBtn: string;
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
  choosePayMethodNamed: (l) =>
    `Выберите способ оплаты и нажмите кнопку ниже: ${l.map((x) => `«${x}»`).join(" или ")}.`,
  choosePayHint:
    "Выберите способ оплаты кнопкой в сообщении выше. Если есть вопрос — напишите, продавец ответит здесь.",
  payLinkAboveHint:
    "Если уже оплатили — заказ подтвердится сам в течение минуты, материалы придут сюда. Если ещё нет — оплатите по кнопке в сообщении выше.",
  dmReceiptPrompt: "Пришлите, пожалуйста, сюда фото или скриншот чека об оплате (можно PDF).",
  payLinkAsText: (url) => `🔗 Ссылка на оплату — откройте её и оплатите:\n${url}`,
  payKaspiBtn: "🧾 Перевод Kaspi",
  payLinkBtn: (kaspi) => (kaspi ? "💳 Оплатить в Kaspi" : "💳 Открыть оплату"),
  payTroubleHandoff:
    "Передал ваш вопрос продавцу: он напишет вам здесь, как удобнее оплатить. Заказ сохранён.",
  payLinkHint:
    "Нажмите кнопку ниже. Если не открывается — скопируйте ссылку и откройте её в браузере или в приложении Kaspi.",
  payByCardBtn: "💳 Картой РФ",
  cardAnyCountryLine:
    "💳 «Картой РФ» — только карты российских банков: сумма в тенге спишется в рублях по курсу банка. Карту Казахстана или другой страны форма не примет — выберите другой способ оплаты.",
  prodamusCardHint:
    "Откройте ссылку и оплатите картой российского банка или Быстрым платежом. Форма покажет сумму в тенге, а банк спишет её в рублях. Форма попросит номер телефона: укажите свой, на него придёт чек. Заказ подтвердится сам сразу после оплаты.",
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
    "На какую почту прислать материалы после оплаты? Файлы придут и сюда, и письмом.\n\nПроверьте адрес: без лишних пробелов и ошибок, например anna@mail.ru\n\n‼️ Почту пишите только текстом: фото и скриншоты с адресом не принимаются.",
  emailAskOptional:
    "Прислать материалы ещё и на почту? Напишите адрес, например anna@mail.ru, или нажмите «Без почты».",
  emailSkipBtn: "Без почты",
  emailHint:
    "Это не похоже на адрес почты. Напишите его целиком, например anna@mail.ru\n\nЧтобы выйти, напишите «отмена».",
  emailTextOnly:
    "‼️ Почту нужно написать текстом, например anna@mail.ru. Фото и скриншоты с адресом не принимаются.",
  emailSaved: (email) => `Записал: ${email}. Материалы придут на этот адрес после проверки оплаты.`,
  proofReceivedEmail: (no, email) =>
    `✅ Чек по заказу #${no} получен. После проверки пришлём материалы сюда и на ${email}.`,
  proofReceivedNeedEmail: (no) =>
    `✅ Чек по заказу #${no} получен.\n\nНа какую почту прислать материалы? Файлы придут и сюда, и письмом. Проверьте адрес перед отправкой.\n\n‼️ Почту пишите только текстом: фото и скриншоты с адресом не принимаются.`,
  notReceiptLike: (no) =>
    `⚠️ Это не похоже на чек оплаты.\n\nПришлите, пожалуйста, скриншот перевода / чека с суммой заказа #${no}.`,
  receiptPaymentFailed: (no) =>
    `⚠️ По этому скриншоту платёж не прошёл (ошибка, отказ или неверные данные).\n\nЗаказ #${no} не выдан. Пришлите чек успешной оплаты — когда перевод действительно зачислится.`,
  receiptManualReview: (no) =>
    `📨 Чек по заказу #${no} получен, но автоматическая проверка не прошла. Заказ отправлен продавцу на ручную проверку — файлы придут после подтверждения.`,
  receiptVerified: (no) => `✅ Спасибо! Чек проверен. Заказ #${no} — отправляю файлы…`,
  thanksReply: "Рада помочь! Хороших уроков 🌷",
  foreignPayReply:
    "Оплату из вашей страны сейчас подключаем. Ваш вопрос уже у продавца: вам напишут здесь, как оплатить.",
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
  reviewAskOne: (name) => `Как вам «${name}»? Поставьте оценку, это поможет другим покупателям:`,
  reviewAskOrder: (no) => `Заказ #${no} у вас уже несколько дней. Как вам покупка? Оцените товары:`,
  reviewAskDirect: (name) => `Как вам «${name}»? Оцените от 1 до 5: ответьте одной цифрой.`,
  ratingThanks: "✅ Спасибо за оценку!",
  inviteFriendBtn: "🎁 Пригласить друга",
  infoOfferBtn: "📄 Оферта",
  infoPrivacyBtn: "🔒 Конфиденциальность",
  infoRequisitesBtn: "🏢 Реквизиты",
  infoAboutBtn: "ℹ️ О продавце",
  openTelegramBtn: "Открыть Telegram ✈️",
  referralWelcome: (p, c) =>
    `🎁 Вам подарок за переход по приглашению — промокод на скидку ${p}% на первую покупку: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Ваш приглашённый друг совершил первую покупку! Промокод на скидку ${p}% для вас: <code>${c}</code>`,
  inviteScreen: (link, came, bought, codes) =>
    `🎁 <b>Пригласить друга</b>\n\nВаша личная ссылка:\n${link}\n\nПришло друзей: <b>${came}</b>\nКупили: <b>${bought}</b>\n\nКогда друг сделает первую покупку, вы получите промокод.${codes ? `\n\nВаши коды за друзей:\n${codes}` : ""}`,
  inviteCodeUsed: "использован",
  inviteShareBtn: "🎁 Поделиться ссылкой",
  cartReminderItems: (items, more, total) =>
    `🛒 В корзине вас ждут: ${items}${more > 0 ? ` и ещё ${more}` : ""}${total ? ` — на сумму ${total}` : ""}. Оформить заказ можно в любой момент.`,
  openCartBtn: "🛒 Открыть корзину",
  fulfillmentReminder: (no, d) => `⏰ Напоминаем: заказ #${no} — получение завтра, ${d}.`,
  courseNewLesson: (no, title) => `📚 Открыт урок ${no}: «${title}».`,
  courseOpenBtn: "Открыть курс",
  coursePreStart: (course, days, date) =>
    `⏳ Курс «${course}» начнётся ${days === 1 ? "завтра" : `через ${days} дн.`} — ${date}. Первый урок придёт сюда.`,
  courseLiveDay: (course, title, when) =>
    `🎥 Скоро эфир по курсу «${course}»: «${title}» — ${when}. Ссылка придёт за час до начала.`,
  courseLiveHour: (course, title, when) =>
    `🎥 Через час эфир по курсу «${course}»: «${title}» — ${when}.`,
  courseLiveJoinBtn: "Войти на эфир",
  courseLiveRec: (course, title, when) =>
    `▶️ Запись эфира готова: «${title}» (${when}), курс «${course}».`,
  courseLiveWatchBtn: "Смотреть запись",
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
  listNumberHint:
    "Чтобы открыть, напишите номер из списка — например, 1. Если это вопрос продавцу, напишите его ещё раз — передам.",
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
  addToCartBtn: "➕ Добавить в корзину",
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
  ticketRateTg: "Оцените, пожалуйста, нашу помощь:",
  ticketRateDm: "Оцените нашу помощь — ответьте цифрой от 1 до 5 (5 — отлично).",
  ticketRateThanks: (n) => `Спасибо за оценку: ${"⭐".repeat(n)}! Нам это важно.`,
  ticketRateAlready: "Оценка уже принята, спасибо!",
  myTicketsBtn: "🆘 Мои обращения",
  shopAppBtn: "🛍 Магазин",
  myTicketsTitle: "Ваши обращения",
  myTicketsEmpty: "У вас пока нет обращений. Чтобы задать вопрос, нажмите кнопку связи в меню.",
  ticketStatus: (s) => ({ open: "Открыто", waiting: "Ждём вас", closed: "Решено" })[s],
  myTicketsMore: (n) => `…и ещё ${n} старых`,
  myTicketsAppendBtn: "✍️ Дописать в обращение",
  myTicketsAppendHint: "Чтобы дописать в открытое обращение, просто напишите сообщение сюда.",
  quizResult: "Вот что вам подойдёт:",
  quizNothing: "Точного совпадения не нашлось — загляните в каталог.",
  quizNotReady: "Подбор ещё не настроен — загляните в каталог.",
  quizDirectHint: "Ответьте номером варианта.",
  quizPick: "Выбрать вариант",
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
  giftBtn: "🎁 Это подарок",
  removeGiftBtn: "❌ Убрать подарок",
  giftRecipientPrompt: "🎁 Кому подарок? Напишите имя получателя.",
  giftMessagePrompt: "💌 Напишите текст открытки (до 300 символов) или нажмите «Пропустить».",
  giftSkipBtn: "Пропустить",
  giftAsk: "🎁 Это подарок? Запишу получателя и текст открытки для продавца.",
  giftYesBtn: "Да, подарок",
  giftNoBtn: "Нет",
  giftCartLine: (r, m) => `🎁 Подарок${r ? ` для ${r}` : ""}${m ? `\n💌 «${m}»` : ""}\n`,
  giftTruncatedNote: (n) => `Текст длиннее ${n} символов — сохранил первые ${n}.`,
  giftWrapBtn: (p) => `📦 Подарочная упаковка +${p}`,
  removeGiftWrapBtn: "❌ Без упаковки",
  giftWrapLine: (p) => `📦 Подарочная упаковка: +${p}\n`,
  giftWrapAsk: (p) => `📦 Добавить подарочную упаковку за ${p}?`,
  giftWrapYesBtn: "С упаковкой",
  giftWrapNoBtn: "Без упаковки",
  giftWrapUnavailable:
    "Подарочная упаковка сейчас недоступна — я её убрал. Оформите заказ ещё раз.",
  giftCertificateDiscountLine: (a) => `🎫 Сертификат: −${a}\n`,
  orderPaidByDiscounts: (no) => `🎉 Заказ #${no} полностью оплачен скидкой — файлы уже в пути.`,
  fulfillmentTypePrompt: "Как вы хотите получить заказ?",
  fulfillmentTypePickupBtn: "🚶 Самовывоз",
  fulfillmentTypeDeliveryBtn: "🚚 Доставка",
  fulfillmentDatePrompt: (d) =>
    `📅 На какую дату? Напишите в формате ДД.ММ.ГГГГ. Ближайшая возможная: ${d}.`,
  fulfillmentDateInvalid: "Не разобрал дату. Формат: ДД.ММ.ГГГГ, например 05.03.2026.",
  fulfillmentDateTooEarly: (d) => `Так быстро не успеем. Ближайшая дата: ${d}.`,
  fulfillmentDateClosed: (d) => `В этот день выдачи нет. Ближайшая дата: ${d}.`,
  fulfillmentDateFull: (d) =>
    d
      ? `На эту дату заказы уже набраны. Ближайшая свободная: ${d}.`
      : "На эту дату заказы уже набраны. Напишите другую дату.",
  fulfillmentSlotFull: "Это время уже занято, выберите другое.",
  orderDayTaken:
    "Пока вы оформляли заказ, места на эту дату разобрали. Заказ не создан — выберите другую дату.",
  orderSlotTaken: "Это время только что заняли. Заказ не создан — выберите другое время.",
  fulfillmentClosedNote: (list) => `Выдачи нет: ${list}.`,
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
  freeDeliveryLeft: (left, from) =>
    `🚚 До бесплатной доставки осталось ${left} (бесплатно от ${from}; считаем по сумме товаров после скидок и баллов).\n`,
  freeDeliveryReached: (from) =>
    `🚚 Доставка бесплатная: товары после скидок на сумму от ${from}.\n`,
  freeWord: "бесплатно",
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
  lowStockLabel: (n) => `⚠️ Осталось ${n} шт.`,
  preorderLabel: (from) =>
    `🕒 Предзаказ: товара пока нет в наличии${from ? `, отправка с ${preorderDate(from, "ru")}` : ", срок отправки уточним"}`,
  preorderCartNote: (from) =>
    `   🕒 предзаказ${from ? `, отправка с ${preorderDate(from, "ru")}` : ""}\n`,
  preorderMoved: (name, from) =>
    `🕒 Срок отправки предзаказа «${name}» изменился: ${from ? `теперь отправка с ${preorderDate(from, "ru")}` : "срок отправки уточним"}.`,
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
  payViaKaspiApipayBtn: "📱 Оплатить в Kaspi",
  kaspiApipayHint:
    "Откройте ссылку и нажмите «Оплатить в Kaspi» — сумма уже подставлена. Заказ подтвердится сам сразу после оплаты.",
  kaspiApipayUnavailable: "Оплата через Kaspi сейчас недоступна — выберите другой способ.",
  payViaProdamusBtn: "🇷🇺 Карта РФ / СБП",
  prodamusHint:
    "Откройте ссылку и оплатите картой российского банка или через СБП. Форма попросит номер телефона: укажите свой, на него придёт чек. Заказ подтвердится сам сразу после оплаты.",
  prodamusRubViaKztHint:
    "Откройте ссылку и оплатите картой российского банка. Форма покажет сумму в тенге, а банк спишет её с карты в рублях. Форма попросит номер телефона: укажите свой, на него придёт чек. Заказ подтвердится сам сразу после оплаты. Если банк отклонит оплату, отключите VPN или попробуйте другую карту; не получится — напишите сюда.",
  prodamusFormSum: (sum) => `в форме оплаты — ${sum}`,
  payManualBtn: "🧾 Перевод по реквизитам + чек",
  robokassaHint: "Нажмите кнопку, оплатите картой — после оплаты всё придёт сюда автоматически.",
  paymentReceived: (no) => `✅ Оплата по заказу #${no} получена.`,
  chooseCountry: "🌍 Выберите страну оплаты:",
  choosePayCountry: "💳 Откуда будете оплачивать? Сумма — в валюте этой страны:",
  countrySaved: (n) => `✅ Страна: ${n}`,
  paymentNotConfigured: "Продавец ещё не настроил способы оплаты. Напишите ему напрямую.",
  countryNoLongerAvailable: "Этот способ оплаты больше недоступен, выберите страну заново.",
  phonePromptHtml:
    "📞 Для связи по заказу поделитесь номером телефона — нажмите кнопку ниже или введите номер вручную.",
  shareContactBtn: "📱 Поделиться номером",
  phoneInvalid: "Не похоже на номер телефона. Введите в формате +7 700 000 00 00.",
  contactSaved: "✅ Номер сохранён.",
  phoneNoted: "Записал ваш номер 👍",
  loginCodeMsg: (code, minutes) =>
    `🔐 Код для входа на сайт: <b>${code}</b>\nДействует ${minutes} минут, подходит один раз. Никому его не сообщайте.`,
  loginCodeWait: "Код уже отправлен. Подождите полминуты и запросите снова.",
  loginCodeBad: "Ссылка для входа устарела. Откройте сайт и нажмите «Войти по коду» ещё раз.",
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
  receiptHowTo:
    "Как прислать чек: в приложении Kaspi или банка откройте этот платёж и сделайте скриншот. Потом здесь, в переписке, нажмите значок фото 🖼 или скрепку 📎 рядом с полем сообщения и выберите скриншот из галереи.",
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
  orderStatusNotice: (status, no) =>
    `${({ in_production: "🧑‍🍳 Заказ готовится", ready: "🎉 Заказ готов к выдаче", delivered: "✅ Заказ выдан. Спасибо!", accepted: "Заказ принят" } as Record<string, string>)[status] ?? status} — #${no}`,
  orderShipped: (no) => `📦 Заказ #${no} отправлен. Спасибо!`,
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
  reorderShort: (items) => `Нет в наличии или стало меньше: ${items.join("; ")}.`,
  reorderNoPaid: "Прошлых оплаченных заказов пока нет — откройте каталог.",
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
  plusWhichProduct:
    "Подскажите, какой материал вас интересует? Напишите его название или откройте каталог 👇",
  nativeCartForwarded:
    "Получил вашу корзину из каталога и передал продавцу — он подтвердит заказ и напишет здесь.",
  deliveryLinksExpire: "Ссылки на файлы действуют 7 дней.",
  downloadBtn: "📥 Скачать",
  deliveryOrderPage: "Все файлы заказа — на странице:",
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
  payViaKaspiApipayBtn: "📱 Kaspi-де төлеу",
  kaspiApipayHint:
    "Сілтемені ашып, төлемді Kaspi-де растаңыз — сома дайын тұр. Тапсырыс төлемнен кейін бірден өзі расталады.",
  kaspiApipayUnavailable: "Kaspi арқылы төлем қазір қолжетімсіз — басқа тәсілді таңдаңыз.",
  choosePayMethodNamed: (l) =>
    `Төлем тәсілін таңдап, төмендегі батырманы басыңыз: ${l.map((x) => `«${x}»`).join(" немесе ")}.`,
  choosePayHint:
    "Жоғарыдағы хабарламадағы батырма арқылы төлем тәсілін таңдаңыз. Сұрағыңыз болса — жазыңыз, сатушы осында жауап береді.",
  payLinkAboveHint:
    "Төлеп қойсаңыз — тапсырыс бір минут ішінде өзі расталады, материалдар осында келеді. Әлі төлемесеңіз — жоғарыдағы хабарламадағы батырма арқылы төлеңіз.",
  dmReceiptPrompt: "Төлем чегінің фотосын немесе скриншотын осында жіберіңізші (PDF те болады).",
  payLinkAsText: (url) => `🔗 Төлем сілтемесі — ашып, төлеңіз:\n${url}`,
  payKaspiBtn: "🧾 Kaspi аударым",
  payLinkBtn: (kaspi) => (kaspi ? "💳 Kaspi арқылы төлеу" : "💳 Төлемді ашу"),
  payTroubleHandoff:
    "Сұрағыңызды сатушыға жібердім: ол осында қалай төлеген ыңғайлы екенін жазады. Тапсырыс сақталды.",
  payLinkHint:
    "Төмендегі батырманы басыңыз. Ашылмаса — сілтемені көшіріп, браузерде немесе Kaspi қосымшасында ашыңыз.",
  payByCardBtn: "💳 РФ картасымен",
  cardAnyCountryLine:
    "💳 «РФ картасымен» — тек Ресей банктерінің карталары: теңгедегі сома банк бағамы бойынша рубльмен шешіледі. Қазақстан немесе басқа ел картасын форма қабылдамайды — басқа төлем тәсілін таңдаңыз.",
  prodamusCardHint:
    "Сілтемені ашып, Ресей банкінің картасымен немесе Жылдам төлеммен төлеңіз. Форма соманы теңгемен көрсетеді, ал банк оны рубльмен шешеді. Форма телефон нөмірін сұрайды: өз нөміріңізді жазыңыз, чек соған келеді. Тапсырыс төлемнен кейін бірден өзі расталады.",
  payViaProdamusBtn: "🇷🇺 РФ картасы / СБП",
  prodamusHint:
    "Сілтемені ашып, Ресей банкінің картасымен немесе СБП арқылы төлеңіз. Форма телефон нөмірін сұрайды: өз нөміріңізді жазыңыз, чек соған келеді. Тапсырыс төлемнен кейін бірден өзі расталады.",
  prodamusRubViaKztHint:
    "Сілтемені ашып, Ресей банкінің картасымен төлеңіз. Форма соманы теңгемен көрсетеді, ал банк оны картадан рубльмен шешеді. Форма телефон нөмірін сұрайды: өз нөміріңізді жазыңыз, чек соған келеді. Тапсырыс төлемнен кейін бірден өзі расталады. Банк төлемді қабылдамаса, VPN-ді өшіріп, басқа картамен көріңіз; болмаса — осында жазыңыз.",
  prodamusFormSum: (sum) => `төлем формасында — ${sum}`,
  phoneNoted: "Нөміріңізді жазып алдым 👍",
  loginCodeMsg: (code, minutes) =>
    `🔐 Сайтқа кіру коды: <b>${code}</b>\n${minutes} минут жарамды, бір рет қана қолданылады. Оны ешкімге айтпаңыз.`,
  loginCodeWait: "Код жіберілді. Жарты минут күтіп, қайта сұраңыз.",
  loginCodeBad: "Кіру сілтемесі ескірген. Сайтты ашып, «Код арқылы кіру» батырмасын қайта басыңыз.",
  giftBtn: "🎁 Бұл сыйлық",
  removeGiftBtn: "❌ Сыйлықты алып тастау",
  giftRecipientPrompt: "🎁 Сыйлық кімге? Алушының атын жазыңыз.",
  giftMessagePrompt: "💌 Открытка мәтінін жазыңыз (300 таңбаға дейін) немесе «Өткізу» басыңыз.",
  giftSkipBtn: "Өткізу",
  giftAsk: "🎁 Бұл сыйлық па? Алушыны және открытка мәтінін сатушыға жазып қоямын.",
  giftYesBtn: "Иә, сыйлық",
  giftNoBtn: "Жоқ",
  giftCartLine: (r, m) => `🎁 Сыйлық${r ? ` — ${r}` : ""}${m ? `\n💌 «${m}»` : ""}\n`,
  giftTruncatedNote: (n) => `Мәтін ${n} таңбадан ұзын — алғашқы ${n} таңба сақталды.`,
  giftWrapBtn: (p) => `📦 Сыйлық қаптамасы +${p}`,
  removeGiftWrapBtn: "❌ Қаптамасыз",
  giftWrapLine: (p) => `📦 Сыйлық қаптамасы: +${p}\n`,
  giftWrapAsk: (p) => `📦 Сыйлық қаптамасын ${p} бағасына қосайық ба?`,
  giftWrapYesBtn: "Қаптамамен",
  giftWrapNoBtn: "Қаптамасыз",
  giftWrapUnavailable:
    "Сыйлық қаптамасы қазір қолжетімсіз — алып тастадым. Тапсырысты қайта рәсімдеңіз.",
  fulfillmentDateClosed: (d) => `Бұл күні беру жоқ. Ең жақын күн: ${d}.`,
  fulfillmentDateFull: (d) =>
    d
      ? `Бұл күнге тапсырыстар толды. Ең жақын бос күн: ${d}.`
      : "Бұл күнге тапсырыстар толды. Басқа күнді жазыңыз.",
  fulfillmentSlotFull: "Бұл уақыт бос емес, басқасын таңдаңыз.",
  orderDayTaken:
    "Тапсырысты рәсімдеп жатқанда бұл күнге орындар таусылды. Тапсырыс жасалмады — басқа күнді таңдаңыз.",
  orderSlotTaken: "Бұл уақытты жаңа ғана алып қойды. Тапсырыс жасалмады — басқа уақытты таңдаңыз.",
  fulfillmentClosedNote: (list) => `Беру жоқ: ${list}.`,
  freeDeliveryLeft: (left, from) =>
    `🚚 Тегін жеткізуге ${left} қалды (${from}-дан бастап тегін; жеңілдіктер мен ұпайлардан кейінгі тауар сомасы бойынша есептейміз).\n`,
  freeDeliveryReached: (from) =>
    `🚚 Жеткізу тегін: жеңілдіктерден кейінгі тауар сомасы ${from}-дан жоғары.\n`,
  freeWord: "тегін",
  lowStockLabel: (n) => `⚠️ Қалды ${n} дана`,
  preorderLabel: (from) =>
    `🕒 Алдын ала тапсырыс: тауар әзірге қоймада жоқ${from ? `, ${preorderDate(from, "kk")} күнінен бастап жіберіледі` : ", жіберу мерзімін нақтылаймыз"}`,
  preorderCartNote: (from) =>
    `   🕒 алдын ала тапсырыс${from ? `, ${preorderDate(from, "kk")} бастап жіберіледі` : ""}\n`,
  preorderMoved: (name, from) =>
    `🕒 «${name}» алдын ала тапсырысының жіберу мерзімі өзгерді: ${from ? `енді ${preorderDate(from, "kk")} күнінен бастап жіберіледі` : "жіберу мерзімін нақтылаймыз"}.`,
  orderStatusNotice: (status, no) =>
    `${({ in_production: "🧑‍🍳 Тапсырыс дайындалуда", ready: "🎉 Тапсырыс беруге дайын", delivered: "✅ Тапсырыс берілді. Рақмет!", accepted: "Тапсырыс қабылданды" } as Record<string, string>)[status] ?? status} — #${no}`,
  orderShipped: (no) => `📦 №${no} тапсырыс жөнелтілді. Рақмет!`,
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
  receiptHowTo:
    "Чекті қалай жіберу керек: Kaspi немесе банк қосымшасында осы төлемді ашып, скриншот жасаңыз. Содан кейін осы чатта хабарлама жолының жанындағы сурет 🖼 немесе қыстырғыш 📎 белгісін басып, скриншотты галереядан таңдаңыз.",
  payReminderAmount: (a) => `💰 Төлеуге: <b>${a}</b>`,
  payReminderDeposit: (due, total) =>
    `Қазір — кепілақы ${due}, қалғаны алған кезде (барлығы ${total}).`,
  payReminderNoDetails: "Төлем деректемелерін сатушыдан нақтылаңыз.",
  payReminderLink: (url) => `Төлеуге және чекті жіберуге тапсырыс бетінде болады:\n${url}`,
  emailSaveFailed: "Поштаны сақтау мүмкін болмады. Мекенжайды қайта жіберіңізші.",
  emailAsk:
    "Төлемнен кейін материалдарды қай поштаға жіберейік? Файлдар осында да, хатпен де келеді.\n\nМекенжайды тексеріңіз: артық бос орынсыз және қатесіз, мысалы anna@mail.ru\n\n‼️ Поштаны тек мәтінмен жазыңыз: мекенжайы бар фото мен скриншот қабылданбайды.",
  emailAskOptional:
    "Материалдарды поштаға да жіберейік пе? Мекенжайды жазыңыз, мысалы anna@mail.ru, немесе «Поштасыз» түймесін басыңыз.",
  emailSkipBtn: "Поштасыз",
  emailHint:
    "Бұл пошта мекенжайына ұқсамайды. Толық жазыңыз, мысалы anna@mail.ru\n\nШығу үшін «болдырмау» деп жазыңыз.",
  emailTextOnly:
    "‼️ Поштаны мәтінмен жазу керек, мысалы anna@mail.ru. Мекенжайы бар фото мен скриншот қабылданбайды.",
  emailSaved: (email) =>
    `Жаздым: ${email}. Төлем тексерілген соң материалдар осы мекенжайға келеді.`,
  proofReceivedEmail: (no, email) =>
    `✅ #${no} тапсырыстың чегі алынды. Тексерістен кейін материалдарды осында және ${email} мекенжайына жібереміз.`,
  proofReceivedNeedEmail: (no) =>
    `✅ #${no} тапсырыстың чегі алынды.\n\nМатериалдарды қай поштаға жіберейік? Файлдар осында да, хатпен де келеді. Жібермес бұрын мекенжайды тексеріңіз.\n\n‼️ Поштаны тек мәтінмен жазыңыз: мекенжайы бар фото мен скриншот қабылданбайды.`,
  waitlistBtn: "🔔 Түскенде хабарлау",
  upsellHeader: "✨ Мұнымен бірге жиі алады:",
  quizBtn: "🧩 Тауар таңдау",
  ticketPrompt: "Сұрағыңызды бір хабарламамен сипаттаңыз — дүкен командасына жеткіземін.",
  payMethods: (list) =>
    `Төлеу тәсілдері:\n${list}\n\nКаталогтан тауар таңдаңыз — деректемелерді тапсырысты рәсімдегенде көрсетемін.`,
  ticketCreated: (no) => `📨 #${no} өтініш қабылданды. Осы чатта жауап береміз.`,
  ticketAppended: (no) => `📨 #${no} өтінішке қостым. Осында жауап береміз.`,
  ticketClosed: (no) => `✅ #${no} өтініш жабылды. Сұрақ қалса — қайта жазыңыз.`,
  ticketRateTg: "Көмегімізді бағалаңыз:",
  ticketRateDm: "Көмегімізді бағалаңыз — 1-ден 5-ке дейінгі санмен жауап беріңіз (5 — тамаша).",
  ticketRateThanks: (n) => `Бағаңызға рахмет: ${"⭐".repeat(n)}! Бұл біз үшін маңызды.`,
  ticketRateAlready: "Баға қабылданған, рахмет!",
  myTicketsBtn: "🆘 Өтініштерім",
  shopAppBtn: "🛍 Дүкен",
  myTicketsTitle: "Сіздің өтініштеріңіз",
  myTicketsEmpty: "Әзірге өтініштер жоқ. Сұрақ қою үшін мәзірдегі байланыс батырмасын басыңыз.",
  ticketStatus: (s) => ({ open: "Ашық", waiting: "Сізді күтудеміз", closed: "Шешілді" })[s],
  myTicketsMore: (n) => `…тағы ${n} ескі`,
  myTicketsAppendBtn: "✍️ Өтінішке қосу",
  myTicketsAppendHint: "Ашық өтінішке қосу үшін осында хабарлама жазыңыз.",
  quizResult: "Сізге мыналар сәйкес келеді:",
  quizNothing: "Дәл сәйкестік табылмады — каталогқа қараңыз.",
  quizNotReady: "Таңдау әлі бапталмаған — каталогқа қараңыз.",
  quizDirectHint: "Нұсқаның нөмірімен жауап беріңіз.",
  quizPick: "Нұсқаны таңдау",
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
  reorderShort: (items) => `Жоқ немесе азайды: ${items.join("; ")}.`,
  reorderNoPaid: "Бұрын төленген тапсырыс әлі жоқ — каталогты ашыңыз.",
  notReceiptLike: (no) =>
    `⚠️ Бұл төлем чегіне ұқсамайды.\n\n#${no} тапсырысының сомасы көрсетілген аударым/чек скриншотын жіберіңіз.`,
  receiptPaymentFailed: (no) =>
    `⚠️ Бұл скриншот бойынша төлем өтпеген (қате, бас тарту немесе қате деректер).\n\n#${no} тапсырысы берілген жоқ. Аударым нақты түскеннен кейін сәтті төлем чегін жіберіңіз.`,
  receiptManualReview: (no) =>
    `📨 #${no} тапсырысы бойынша чек алынды, бірақ автоматты тексеру өтпеді. Тапсырыс сатушыға қолмен тексеруге жіберілді — файлдар растаудан кейін келеді.`,
  receiptVerified: (no) => `✅ Рақмет! Чек тексерілді. Тапсырыс #${no} — файлдарды жіберудемін…`,
  thanksReply: "Көмектескеніме қуаныштымын! Сабақтарыңыз сәтті өтсін 🌷",
  foreignPayReply:
    "Сіздің елден төлем қабылдауды қазір қосып жатырмыз. Сұрағыңыз сатушыға жіберілді — ол осында қалай төлеуге болатынын жазады.",
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
  reviewAskOne: (name) =>
    `«${name}» сізге қалай? Баға қойыңыз, бұл басқа сатып алушыларға көмектеседі:`,
  reviewAskOrder: (no) =>
    `#${no} тапсырысыңыз бірнеше күн бұрын берілді. Сатып алу қалай? Тауарларды бағалаңыз:`,
  reviewAskDirect: (name) =>
    `«${name}» сізге қалай? 1-ден 5-ке дейін бағалаңыз: бір цифрмен жауап беріңіз.`,
  ratingThanks: "✅ Бағаңыз үшін рахмет!",
  inviteFriendBtn: "🎁 Досты шақыру",
  infoOfferBtn: "📄 Оферта",
  infoPrivacyBtn: "🔒 Құпиялылық",
  infoRequisitesBtn: "🏢 Деректемелер",
  infoAboutBtn: "ℹ️ Сатушы туралы",
  openTelegramBtn: "Telegram-да ашу ✈️",
  referralWelcome: (p, c) =>
    `🎁 Шақыру сілтемесі бойынша өткеніңіз үшін сыйлық — алғашқы сатып алуға ${p}% жеңілдік промокоды: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Сіз шақырған дос алғашқы сатып алуын жасады! Сізге ${p}% жеңілдік промокоды: <code>${c}</code>`,
  inviteScreen: (link, came, bought, codes) =>
    `🎁 <b>Досты шақыру</b>\n\nСіздің жеке сілтемеңіз:\n${link}\n\nКелген достар: <b>${came}</b>\nСатып алғандар: <b>${bought}</b>\n\nДосыңыз алғашқы сатып алуды жасағанда, сіз промокод аласыз.${codes ? `\n\nДостарыңыз үшін кодтарыңыз:\n${codes}` : ""}`,
  inviteCodeUsed: "қолданылған",
  inviteShareBtn: "🎁 Сілтемені бөлісу",
  cartReminderItems: (items, more, total) =>
    `🛒 Себетте сізді күтіп тұр: ${items}${more > 0 ? ` және тағы ${more}` : ""}${total ? ` — жалпы ${total}` : ""}. Тапсырысты кез келген уақытта рәсімдей аласыз.`,
  openCartBtn: "🛒 Себетті ашу",
  fulfillmentReminder: (no, d) => `⏰ Еске саламыз: №${no} тапсырысты алу ертең, ${d}.`,
  courseNewLesson: (no, title) => `📚 ${no}-сабақ ашылды: «${title}».`,
  courseOpenBtn: "Курсты ашу",
  coursePreStart: (course, days, date) =>
    `⏳ «${course}» курсы ${days === 1 ? "ертең" : `${days} күннен кейін`} басталады — ${date}. Бірінші сабақ осында келеді.`,
  courseLiveDay: (course, title, when) =>
    `🎥 «${course}» курсы бойынша жақында эфир: «${title}» — ${when}. Сілтеме басталуынан бір сағат бұрын келеді.`,
  courseLiveHour: (course, title, when) =>
    `🎥 «${course}» курсы бойынша эфирге бір сағат қалды: «${title}» — ${when}.`,
  courseLiveJoinBtn: "Эфирге кіру",
  courseLiveRec: (course, title, when) =>
    `▶️ Эфир жазбасы дайын: «${title}» (${when}), «${course}» курсы.`,
  courseLiveWatchBtn: "Жазбаны көру",
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
  listNumberHint:
    "Ашу үшін тізімнен нөмірін жазыңыз — мысалы, 1. Егер бұл сатушыға сұрақ болса, оны тағы бір рет жазыңыз — жеткіземін.",
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
  addToCartBtn: "➕ Себетке қосу",
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
  choosePayCountry: "💳 Қай елден төлейсіз? Сома сол елдің валютасында:",
  useMenu: "Төмендегі мәзірден бөлімді таңдаңыз 👇",
  plusWhichProduct: "Қай материал қызықтырады? Атауын жазыңыз немесе каталогты ашыңыз 👇",
  nativeCartForwarded:
    "Каталогтан жиналған себетіңізді алдым және сатушыға бердім — ол тапсырысты растап, осында жазады.",
  deliveryLinksExpire: "Файл сілтемелері 7 күн жарамды.",
  downloadBtn: "📥 Жүктеп алу",
  deliveryOrderPage: "Тапсырыстың барлық файлдары — бетте:",
};

const en: Msg = {
  ...ru,
  payViaKaspiApipayBtn: "📱 Pay with Kaspi",
  kaspiApipayHint:
    "Open the link and confirm the payment in Kaspi — the amount is already filled in. The order is confirmed automatically right after payment.",
  kaspiApipayUnavailable: "Kaspi payment is unavailable right now — please choose another method.",
  choosePayMethodNamed: (l) =>
    `Choose how to pay and tap a button below: ${l.map((x) => `“${x}”`).join(" or ")}.`,
  choosePayHint:
    "Pick a payment method with a button in the message above. If you have a question, write it here and the seller will reply.",
  payLinkAboveHint:
    "If you have already paid, the order will be confirmed automatically within a minute and the materials will arrive here. If not yet, pay with the button in the message above.",
  dmReceiptPrompt:
    "Please send a photo or screenshot of your payment receipt here (a PDF works too).",
  payLinkAsText: (url) => `🔗 Payment link — open it and pay:\n${url}`,
  payKaspiBtn: "🧾 Kaspi transfer",
  payLinkBtn: (kaspi) => (kaspi ? "💳 Pay with Kaspi" : "💳 Open payment"),
  payTroubleHandoff:
    "I passed your question to the seller: they will write here about the best way to pay. Your order is saved.",
  payLinkHint:
    "Tap the button below. If it does not open, copy the link and open it in your browser or the Kaspi app.",
  payByCardBtn: "💳 Russian card",
  cardAnyCountryLine:
    "💳 «Russian card» accepts Russian bank cards only: the tenge amount is charged in rubles at your bank's rate. Cards from Kazakhstan or other countries won't work there — please choose another payment method.",
  prodamusCardHint:
    "Open the link and pay with a Russian bank card or Fast Payment. The form shows the amount in tenge; your bank charges it in rubles. The form will ask for a phone number: enter yours, the receipt goes there. The order is confirmed automatically right after payment.",
  phoneNoted: "Got your number 👍",
  loginCodeMsg: (code, minutes) =>
    `🔐 Your website login code: <b>${code}</b>\nValid for ${minutes} minutes, works once. Do not share it with anyone.`,
  loginCodeWait: "The code has been sent. Wait half a minute and ask again.",
  loginCodeBad:
    "The login link has expired. Open the website and press “Log in with a code” again.",
  fulfillmentDateClosed: (d) => `There is no handover on that day. The nearest date: ${d}.`,
  fulfillmentDateFull: (d) =>
    d
      ? `Orders for this date are full. The nearest free date: ${d}.`
      : "Orders for this date are full. Please send another date.",
  fulfillmentSlotFull: "This time is already taken, please pick another.",
  orderDayTaken:
    "The spots for this date ran out while you were checking out. The order was not created — please pick another date.",
  orderSlotTaken: "This time was just taken. The order was not created — please pick another time.",
  fulfillmentClosedNote: (list) => `No handover: ${list}.`,
  freeDeliveryLeft: (left, from) =>
    `🚚 ${left} left until free delivery (free from ${from}; counted on the goods total after discounts and points).\n`,
  freeDeliveryReached: (from) =>
    `🚚 Delivery is free: goods after discounts come to ${from} or more.\n`,
  freeWord: "free",
  lowStockLabel: (n) => `⚠️ Only ${n} left`,
  preorderLabel: (from) =>
    `🕒 Pre-order: not in stock yet${from ? `, ships from ${preorderDate(from, "en")}` : ", we will confirm the shipping date"}`,
  preorderCartNote: (from) =>
    `   🕒 pre-order${from ? `, ships from ${preorderDate(from, "en")}` : ""}\n`,
  preorderMoved: (name, from) =>
    `🕒 The ship date of your pre-order “${name}” has changed: ${from ? `it now ships from ${preorderDate(from, "en")}` : "we will confirm the ship date"}.`,
  orderStatusNotice: (status, no) =>
    `${({ in_production: "🧑‍🍳 Your order is being prepared", ready: "🎉 Your order is ready for pickup", delivered: "✅ Order delivered. Thank you!", accepted: "Order accepted" } as Record<string, string>)[status] ?? status} — #${no}`,
  orderShipped: (no) => `📦 Order #${no} has been shipped. Thank you!`,
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
  payViaProdamusBtn: "🇷🇺 RU card / SBP",
  prodamusHint:
    "Open the link and pay with a Russian bank card or via SBP. The form will ask for a phone number: enter yours, the receipt goes there. The order is confirmed automatically right after payment.",
  prodamusRubViaKztHint:
    "Open the link and pay with a Russian bank card. The form shows the amount in tenge, and your bank charges it to the card in rubles. The form will ask for a phone number: enter yours, the receipt goes there. The order is confirmed automatically right after payment. If the bank declines the payment, turn off your VPN or try another card; if it still fails, write here.",
  prodamusFormSum: (sum) => `${sum} in the payment form`,
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
    "Which email should we send the materials to after payment? Files will come here and by email.\n\nPlease check the address: no extra spaces or typos, e.g. anna@mail.ru\n\n‼️ Please type your email as text: photos and screenshots of the address are not accepted.",
  emailAskOptional:
    "Send the materials to your email as well? Type the address, e.g. anna@mail.ru, or tap “No email”.",
  emailSkipBtn: "No email",
  emailHint:
    "That doesn't look like an email address. Please type it in full, e.g. anna@mail.ru\n\nTo exit, type “cancel”.",
  emailTextOnly:
    "‼️ Please type your email as text, e.g. anna@mail.ru. Photos and screenshots of the address are not accepted.",
  emailSaved: (email) =>
    `Saved: ${email}. The materials will go to this address once payment is checked.`,
  proofReceivedEmail: (no, email) =>
    `✅ Receipt for order #${no} received. After checking we'll send the materials here and to ${email}.`,
  proofReceivedNeedEmail: (no) =>
    `✅ Receipt for order #${no} received.\n\nWhich email should we send the materials to? Files will come here and by email. Please check the address before sending.\n\n‼️ Please type your email as text: photos and screenshots of the address are not accepted.`,
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
  ticketRateTg: "Please rate our help:",
  ticketRateDm: "Please rate our help — reply with a number from 1 to 5 (5 is great).",
  ticketRateThanks: (n) => `Thanks for your rating: ${"⭐".repeat(n)}! It matters to us.`,
  ticketRateAlready: "Your rating is already recorded, thank you!",
  myTicketsBtn: "🆘 My requests",
  shopAppBtn: "🛍 Shop",
  myTicketsTitle: "Your requests",
  myTicketsEmpty:
    "You have no requests yet. To ask a question, use the contact button in the menu.",
  ticketStatus: (s) => ({ open: "Open", waiting: "Waiting for you", closed: "Resolved" })[s],
  myTicketsMore: (n) => `…and ${n} older`,
  myTicketsAppendBtn: "✍️ Add to request",
  myTicketsAppendHint: "To add to an open request, just write a message here.",
  quizResult: "Here is what suits you:",
  quizNothing: "No exact match — have a look at the catalog.",
  quizNotReady: "The picker is not set up yet — have a look at the catalog.",
  quizDirectHint: "Reply with the number of an option.",
  quizPick: "Choose an option",
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
  reorderShort: (items) => `Not available or fewer than before: ${items.join("; ")}.`,
  reorderNoPaid: "You have no paid orders yet — open the catalog.",
  notReceiptLike: (no) =>
    `⚠️ This doesn’t look like a payment receipt.\n\nPlease send a screenshot of the transfer/receipt showing the amount for order #${no}.`,
  receiptPaymentFailed: (no) =>
    `⚠️ This screenshot shows the payment did not go through (error, declined, or invalid details).\n\nOrder #${no} was not fulfilled. Please send a receipt of a successful payment once the transfer is completed.`,
  receiptManualReview: (no) =>
    `📨 Receipt received for order #${no}, but automatic verification failed. The order was sent to the seller for manual review — files will arrive after confirmation.`,
  receiptVerified: (no) => `✅ Thank you! Receipt verified. Order #${no} — sending files…`,
  thanksReply: "Happy to help! Have great lessons 🌷",
  foreignPayReply:
    "We are setting up payments from your country right now. Your question has been passed to the seller, who will write here how to pay.",
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
  reviewAskOne: (name) => `How do you like “${name}”? Leave a rating, it helps other buyers:`,
  reviewAskOrder: (no) =>
    `Your order #${no} was delivered a few days ago. How was it? Rate the products:`,
  reviewAskDirect: (name) =>
    `How do you like “${name}”? Rate it from 1 to 5: reply with a single digit.`,
  ratingThanks: "✅ Thank you for your rating!",
  inviteFriendBtn: "🎁 Invite a friend",
  infoOfferBtn: "📄 Offer",
  infoPrivacyBtn: "🔒 Privacy",
  infoRequisitesBtn: "🏢 Business details",
  infoAboutBtn: "ℹ️ About the seller",
  openTelegramBtn: "Open in Telegram ✈️",
  referralWelcome: (p, c) =>
    `🎁 A gift for joining via an invitation — a ${p}% discount code for your first purchase: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Your invited friend made their first purchase! Here is a ${p}% discount code for you: <code>${c}</code>`,
  inviteScreen: (link, came, bought, codes) =>
    `🎁 <b>Invite a friend</b>\n\nYour personal link:\n${link}\n\nFriends joined: <b>${came}</b>\nBought: <b>${bought}</b>\n\nWhen a friend makes a first purchase, you get a promo code.${codes ? `\n\nYour codes for friends:\n${codes}` : ""}`,
  inviteCodeUsed: "used",
  inviteShareBtn: "🎁 Share the link",
  cartReminderItems: (items, more, total) =>
    `🛒 Waiting in your cart: ${items}${more > 0 ? ` and ${more} more` : ""}${total ? ` — ${total} in total` : ""}. You can check out anytime.`,
  openCartBtn: "🛒 Open cart",
  fulfillmentReminder: (no, d) => `⏰ Reminder: order #${no} — pickup/delivery is tomorrow, ${d}.`,
  courseNewLesson: (no, title) => `📚 Lesson ${no} is open: “${title}”.`,
  courseOpenBtn: "Open the course",
  coursePreStart: (course, days, date) =>
    `⏳ The course “${course}” starts ${days === 1 ? "tomorrow" : `in ${days} days`} — ${date}. The first lesson will arrive here.`,
  courseLiveDay: (course, title, when) =>
    `🎥 A live session for “${course}” is coming up: “${title}” — ${when}. The link arrives an hour before it starts.`,
  courseLiveHour: (course, title, when) =>
    `🎥 A live session for “${course}” starts in an hour: “${title}” — ${when}.`,
  courseLiveJoinBtn: "Join the live session",
  courseLiveRec: (course, title, when) =>
    `▶️ The recording is ready: “${title}” (${when}), course “${course}”.`,
  courseLiveWatchBtn: "Watch the recording",
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
  listNumberHint:
    "To open one, type its number from the list — for example, 1. If this is a question for the seller, send it again and I’ll pass it on.",
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
  addToCartBtn: "➕ Add to cart",
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
  giftBtn: "🎁 This is a gift",
  removeGiftBtn: "❌ Remove gift mark",
  giftRecipientPrompt: "🎁 Who is the gift for? Write the recipient's name.",
  giftMessagePrompt: "💌 Write the card message (up to 300 characters) or tap “Skip”.",
  giftSkipBtn: "Skip",
  giftAsk: "🎁 Is this a gift? I will pass the recipient and card message to the seller.",
  giftYesBtn: "Yes, a gift",
  giftNoBtn: "No",
  giftCartLine: (r, m) => `🎁 Gift${r ? ` for ${r}` : ""}${m ? `\n💌 “${m}”` : ""}\n`,
  giftTruncatedNote: (n) => `The text is longer than ${n} characters — kept the first ${n}.`,
  giftWrapBtn: (p) => `📦 Gift wrapping +${p}`,
  removeGiftWrapBtn: "❌ No wrapping",
  giftWrapLine: (p) => `📦 Gift wrapping: +${p}\n`,
  giftWrapAsk: (p) => `📦 Add gift wrapping for ${p}?`,
  giftWrapYesBtn: "With wrapping",
  giftWrapNoBtn: "No wrapping",
  giftWrapUnavailable:
    "Gift wrapping is unavailable right now — I removed it. Please place the order again.",
  giftCertificateDiscountLine: (a) => `🎫 Certificate: −${a}\n`,
  orderPaidByDiscounts: (no) =>
    `🎉 Order #${no} is fully covered by your discounts — files are on the way.`,
  chooseCountry: "🌍 Choose your payment country:",
  choosePayCountry: "💳 Where will you pay from? The amount is in that country's currency:",
  phonePromptHtml:
    "📞 Share your phone number for order updates — tap the button below or type it.",
  shareContactBtn: "📱 Share number",
  afterProofManual:
    "After paying, send a photo or PDF of the receipt here — the seller will confirm and deliver.",
  sendReceiptPrompt:
    "Please send a photo or PDF of your payment receipt. Tap any menu button to go back.",
  receiptHowTo:
    "How to send the receipt: open this payment in the Kaspi or bank app and take a screenshot. Then, here in the chat, tap the photo 🖼 or paperclip 📎 icon next to the message field and pick the screenshot from your gallery.",
  useMenu: "Pick a section from the menu below 👇",
  plusWhichProduct: "Which material are you interested in? Type its name or open the catalog 👇",
  nativeCartForwarded:
    "Got your cart from the catalog and passed it to the seller — they will confirm the order and reply here.",
  deliveryLinksExpire: "Links to the files are valid for 7 days.",
  downloadBtn: "📥 Download",
  deliveryOrderPage: "All order files are on the page:",
};

const uz: Msg = {
  ...ru,
  payViaKaspiApipayBtn: "📱 Kaspi orqali toʻlash",
  kaspiApipayHint:
    "Havolani oching va toʻlovni Kaspi’da tasdiqlang — summa allaqachon qoʻyilgan. Buyurtma toʻlovdan soʻng darhol oʻzi tasdiqlanadi.",
  kaspiApipayUnavailable: "Kaspi orqali toʻlov hozir mavjud emas — boshqa usulni tanlang.",
  choosePayMethodNamed: (l) =>
    `To‘lov usulini tanlang va pastdagi tugmani bosing: ${l.map((x) => `«${x}»`).join(" yoki ")}.`,
  choosePayHint:
    "Yuqoridagi xabardagi tugma orqali to‘lov usulini tanlang. Savolingiz bo‘lsa, yozing, sotuvchi shu yerda javob beradi.",
  payLinkAboveHint:
    "Agar to‘lagan bo‘lsangiz — buyurtma bir daqiqa ichida avtomatik tasdiqlanadi, materiallar shu yerga keladi. Hali to‘lamagan bo‘lsangiz — yuqoridagi xabardagi tugma orqali to‘lang.",
  dmReceiptPrompt:
    "Iltimos, to‘lov chekining rasmi yoki skrinshotini shu yerga yuboring (PDF ham bo‘ladi).",
  payLinkAsText: (url) => `🔗 To‘lov havolasi — oching va to‘lang:\n${url}`,
  choosePayCountry: "💳 Qaysi davlatdan to‘laysiz? Summa o‘sha davlat valyutasida:",
  payKaspiBtn: "🧾 Kaspi o‘tkazma",
  payLinkBtn: (kaspi) => (kaspi ? "💳 Kaspi orqali to‘lash" : "💳 To‘lovni ochish"),
  payTroubleHandoff:
    "Savolingizni sotuvchiga yubordim: u shu yerda qanday to‘lash qulayligini yozadi. Buyurtma saqlandi.",
  receiptHowTo:
    "Chekni qanday yuborish: Kaspi yoki bank ilovasida shu to‘lovni oching va skrinshot oling. Keyin shu chatda xabar maydoni yonidagi rasm 🖼 yoki qisqich 📎 belgisini bosing va skrinshotni galereyadan tanlang.",
  payLinkHint:
    "Quyidagi tugmani bosing. Ochilmasa — havolani nusxalab, brauzerda yoki Kaspi ilovasida oching.",
  payByCardBtn: "💳 RF kartasi",
  cardAnyCountryLine:
    "💳 «RF kartasi» — faqat Rossiya banklari kartalari: tengedagi summa bank kursi bo‘yicha rublda yechiladi. Qozog‘iston yoki boshqa davlat kartasini forma qabul qilmaydi — boshqa to‘lov usulini tanlang.",
  prodamusCardHint:
    "Havolani oching va Rossiya banki kartasi yoki Tezkor to‘lov bilan to‘lang. Forma summani tengeda ko‘rsatadi, bank esa uni rublda yechadi. Forma telefon raqamini so‘raydi: o‘z raqamingizni kiriting, chek unga keladi. Buyurtma to‘lovdan so‘ng darhol avtomatik tasdiqlanadi.",
  payViaProdamusBtn: "🇷🇺 RF kartasi / SBP",
  prodamusHint:
    "Havolani oching va Rossiya banki kartasi yoki SBP orqali to‘lang. Forma telefon raqamini so‘raydi: o‘z raqamingizni kiriting, chek unga keladi. Buyurtma to‘lovdan so‘ng darhol o‘zi tasdiqlanadi.",
  prodamusRubViaKztHint:
    "Havolani oching va Rossiya banki kartasi bilan to‘lang. Forma summani tengeda ko‘rsatadi, bank esa uni kartadan rublda yechadi. Forma telefon raqamini so‘raydi: o‘z raqamingizni kiriting, chek unga keladi. Buyurtma to‘lovdan so‘ng darhol o‘zi tasdiqlanadi. Bank to‘lovni rad etsa, VPN’ni o‘chiring yoki boshqa karta bilan urinib ko‘ring; bo‘lmasa, shu yerga yozing.",
  prodamusFormSum: (sum) => `to‘lov formasida — ${sum}`,
  cartHeader: "🛒 <b>Savatingiz</b>\n\n",
  phoneNoted: "Raqamingizni yozib oldim 👍",
  loginCodeMsg: (code, minutes) =>
    `🔐 Saytga kirish kodi: <b>${code}</b>\n${minutes} daqiqa amal qiladi, bir marta ishlaydi. Uni hech kimga aytmang.`,
  loginCodeWait: "Kod yuborildi. Yarim daqiqa kutib, qayta so‘rang.",
  loginCodeBad:
    "Kirish havolasi eskirgan. Saytni ochib, «Kod orqali kirish» tugmasini qayta bosing.",
  giftBtn: "🎁 Bu sovg‘a",
  removeGiftBtn: "❌ Sovg‘a belgisini olib tashlash",
  giftRecipientPrompt: "🎁 Sovg‘a kimga? Oluvchining ismini yozing.",
  giftMessagePrompt:
    "💌 Otkritka matnini yozing (300 belgigacha) yoki «O‘tkazib yuborish»ni bosing.",
  giftSkipBtn: "O‘tkazib yuborish",
  giftAsk: "🎁 Bu sovg‘ami? Oluvchi va otkritka matnini sotuvchiga yozib qo‘yaman.",
  giftYesBtn: "Ha, sovg‘a",
  giftNoBtn: "Yo‘q",
  giftCartLine: (r, m) => `🎁 Sovg‘a${r ? ` — ${r}` : ""}${m ? `\n💌 «${m}»` : ""}\n`,
  giftTruncatedNote: (n) => `Matn ${n} belgidan uzun — dastlabki ${n} belgi saqlandi.`,
  giftWrapBtn: (p) => `📦 Sovg‘a qadog‘i +${p}`,
  removeGiftWrapBtn: "❌ Qadoqsiz",
  giftWrapLine: (p) => `📦 Sovg‘a qadog‘i: +${p}\n`,
  giftWrapAsk: (p) => `📦 Sovg‘a qadog‘ini ${p} narxida qo‘shamizmi?`,
  giftWrapYesBtn: "Qadoq bilan",
  giftWrapNoBtn: "Qadoqsiz",
  giftWrapUnavailable:
    "Sovg‘a qadog‘i hozir mavjud emas — uni olib tashladim. Buyurtmani qayta rasmiylashtiring.",
  fulfillmentDateClosed: (d) => `Bu kuni topshirish yo‘q. Eng yaqin sana: ${d}.`,
  fulfillmentDateFull: (d) =>
    d
      ? `Bu sanaga buyurtmalar to‘lgan. Eng yaqin bo‘sh sana: ${d}.`
      : "Bu sanaga buyurtmalar to‘lgan. Boshqa sanani yozing.",
  fulfillmentSlotFull: "Bu vaqt band, boshqasini tanlang.",
  orderDayTaken:
    "Buyurtma rasmiylashtirilayotganda bu sanadagi joylar tugadi. Buyurtma yaratilmadi — boshqa sanani tanlang.",
  orderSlotTaken: "Bu vaqt hozirgina band qilindi. Buyurtma yaratilmadi — boshqa vaqtni tanlang.",
  fulfillmentClosedNote: (list) => `Topshirish yo‘q: ${list}.`,
  freeDeliveryLeft: (left, from) =>
    `🚚 Bepul yetkazishgacha ${left} qoldi (${from} dan bepul; chegirma va ballardan keyingi tovarlar summasi bo‘yicha hisoblaymiz).\n`,
  freeDeliveryReached: (from) =>
    `🚚 Yetkazish bepul: chegirmalardan keyingi tovarlar summasi ${from} dan yuqori.\n`,
  freeWord: "bepul",
  lowStockLabel: (n) => `⚠️ ${n} dona qoldi`,
  preorderLabel: (from) =>
    `🕒 Oldindan buyurtma: mahsulot hozircha omborda yo‘q${from ? `, ${preorderDate(from, "uz")} dan boshlab jo‘natiladi` : ", jo‘natish muddatini aniqlaymiz"}`,
  preorderCartNote: (from) =>
    `   🕒 oldindan buyurtma${from ? `, ${preorderDate(from, "uz")} dan jo‘natiladi` : ""}\n`,
  preorderMoved: (name, from) =>
    `🕒 «${name}» oldindan buyurtmasining joʻnatish muddati oʻzgardi: ${from ? `endi ${preorderDate(from, "uz")} dan joʻnatiladi` : "joʻnatish muddatini aniqlaymiz"}.`,
  orderStatusNotice: (status, no) =>
    `${({ in_production: "🧑‍🍳 Buyurtma tayyorlanmoqda", ready: "🎉 Buyurtma topshirishga tayyor", delivered: "✅ Buyurtma topshirildi. Rahmat!", accepted: "Buyurtma qabul qilindi" } as Record<string, string>)[status] ?? status} — #${no}`,
  orderShipped: (no) => `📦 #${no}-buyurtma joʻnatildi. Rahmat!`,
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
    "To‘lovdan keyin materiallarni qaysi pochtaga yuboraylik? Fayllar shu yerga ham, xat orqali ham keladi.\n\nManzilni tekshiring: ortiqcha bo‘shliq va xatosiz, masalan anna@mail.ru\n\n‼️ Pochtani faqat matn bilan yozing: manzil yozilgan rasm va skrinshotlar qabul qilinmaydi.",
  emailAskOptional:
    "Materiallarni pochtaga ham yuboraylikmi? Manzilni yozing, masalan anna@mail.ru, yoki «Pochtasiz» tugmasini bosing.",
  emailSkipBtn: "Pochtasiz",
  emailHint:
    "Bu pochta manziliga o‘xshamaydi. To‘liq yozing, masalan anna@mail.ru\n\nChiqish uchun «bekor» deb yozing.",
  emailTextOnly:
    "‼️ Pochtani matn bilan yozish kerak, masalan anna@mail.ru. Manzil yozilgan rasm va skrinshotlar qabul qilinmaydi.",
  emailSaved: (email) =>
    `Yozib oldim: ${email}. To‘lov tekshirilgach materiallar shu manzilga keladi.`,
  proofReceivedEmail: (no, email) =>
    `✅ #${no} buyurtma cheki qabul qilindi. Tekshirgach materiallarni shu yerga va ${email} manziliga yuboramiz.`,
  proofReceivedNeedEmail: (no) =>
    `✅ #${no} buyurtma cheki qabul qilindi.\n\nMateriallarni qaysi pochtaga yuboraylik? Fayllar shu yerga ham, xat orqali ham keladi. Yuborishdan oldin manzilni tekshiring.\n\n‼️ Pochtani faqat matn bilan yozing: manzil yozilgan rasm va skrinshotlar qabul qilinmaydi.`,
  waitlistBtn: "🔔 Kelganda xabar berish",
  upsellHeader: "✨ Bu bilan ko‘pincha olishadi:",
  quizBtn: "🧩 Mahsulot tanlash",
  ticketPrompt: "Savolingizni bitta xabarda yozing — do‘kon jamoasiga yetkazaman.",
  payMethods: (list) =>
    `To‘lov usullari:\n${list}\n\nKatalogdan mahsulot tanlang — rekvizitlarni buyurtma rasmiylashtirilganda ko‘rsataman.`,
  ticketCreated: (no) => `📨 #${no} murojaat qabul qilindi. Shu chatda javob beramiz.`,
  ticketAppended: (no) => `📨 #${no} murojaatga qo‘shdim. Shu yerda javob beramiz.`,
  ticketClosed: (no) => `✅ #${no} murojaat yopildi. Savol qolsa — yana yozing.`,
  ticketRateTg: "Yordamimizni baholang:",
  ticketRateDm: "Yordamimizni baholang — 1 dan 5 gacha raqam bilan javob bering (5 — a’lo).",
  ticketRateThanks: (n) => `Bahoyingiz uchun rahmat: ${"⭐".repeat(n)}! Bu biz uchun muhim.`,
  ticketRateAlready: "Baho qabul qilingan, rahmat!",
  myTicketsBtn: "🆘 Murojaatlarim",
  shopAppBtn: "🛍 Do‘kon",
  myTicketsTitle: "Murojaatlaringiz",
  myTicketsEmpty: "Hozircha murojaatlar yoʻq. Savol berish uchun menyudagi aloqa tugmasini bosing.",
  ticketStatus: (s) => ({ open: "Ochiq", waiting: "Sizni kutmoqdamiz", closed: "Hal qilindi" })[s],
  myTicketsMore: (n) => `…yana ${n} ta eski`,
  myTicketsAppendBtn: "✍️ Murojaatga qoʻshish",
  myTicketsAppendHint: "Ochiq murojaatga qoʻshish uchun shu yerga xabar yozing.",
  quizResult: "Sizga mos keladiganlari:",
  quizNothing: "Aniq moslik topilmadi — katalogga qarang.",
  quizNotReady: "Tanlash hali sozlanmagan — katalogga qarang.",
  quizDirectHint: "Variant raqami bilan javob bering.",
  quizPick: "Variantni tanlash",
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
  reorderShort: (items) => `Mavjud emas yoki kamaydi: ${items.join("; ")}.`,
  reorderNoPaid: "Hozircha to‘langan buyurtmangiz yo‘q — katalogni oching.",
  notReceiptLike: (no) =>
    `⚠️ Bu to‘lov chekiga o‘xshamayapti.\n\n#${no} buyurtma summasi ko‘rsatilgan o‘tkazma/chek skrinshotini yuboring.`,
  receiptPaymentFailed: (no) =>
    `⚠️ Bu skrinshotda to‘lov o‘tmagan (xato, rad etilgan yoki noto‘g‘ri ma’lumot).\n\n#${no} buyurtma berilmadi. O‘tkazma haqiqatan o‘tgach, muvaffaqiyatli to‘lov chekini yuboring.`,
  receiptManualReview: (no) =>
    `📨 #${no} buyurtmasi uchun chek qabul qilindi, lekin avtomatik tekshiruv o‘tmadi. Buyurtma sotuvchiga qo‘lda tekshirish uchun yuborildi — fayllar tasdiqlangandan so‘ng keladi.`,
  receiptVerified: (no) => `✅ Rahmat! Chek tekshirildi. Buyurtma #${no} — fayllar yuborilmoqda…`,
  thanksReply: "Yordam berganimdan xursandman! Darslaringiz yaxshi o‘tsin 🌷",
  foreignPayReply:
    "Davlatingizdan to‘lovni hozir ulayapmiz. Savolingiz sotuvchiga yuborildi — u shu yerda qanday to‘lashni yozadi.",
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
  reviewAskOne: (name) =>
    `«${name}» sizga qanday? Baho qoʻying, bu boshqa xaridorlarga yordam beradi:`,
  reviewAskOrder: (no) =>
    `#${no} buyurtmangiz bir necha kun oldin topshirilgan. Xarid qanday? Mahsulotlarni baholang:`,
  reviewAskDirect: (name) =>
    `«${name}» sizga qanday? 1 dan 5 gacha baholang: bitta raqam bilan javob bering.`,
  ratingThanks: "✅ Bahoyingiz uchun rahmat!",
  inviteFriendBtn: "🎁 Do‘stni taklif qilish",
  infoOfferBtn: "📄 Oferta",
  infoPrivacyBtn: "🔒 Maxfiylik",
  infoRequisitesBtn: "🏢 Rekvizitlar",
  infoAboutBtn: "ℹ️ Sotuvchi haqida",
  openTelegramBtn: "Telegramga o‘tish ✈️",
  referralWelcome: (p, c) =>
    `🎁 Taklif havolasi orqali o‘tganingiz uchun sovg‘a — birinchi xaridga ${p}% chegirma promokodi: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Siz taklif qilgan do‘stingiz birinchi xaridini qildi! Sizga ${p}% chegirma promokodi: <code>${c}</code>`,
  inviteScreen: (link, came, bought, codes) =>
    `🎁 <b>Do‘stni taklif qilish</b>\n\nShaxsiy havolangiz:\n${link}\n\nKelgan do‘stlar: <b>${came}</b>\nXarid qilganlar: <b>${bought}</b>\n\nDo‘stingiz birinchi xaridni qilganda, siz promokod olasiz.${codes ? `\n\nDo‘stlar uchun kodlaringiz:\n${codes}` : ""}`,
  inviteCodeUsed: "ishlatilgan",
  inviteShareBtn: "🎁 Havolani ulashish",
  cartReminderItems: (items, more, total) =>
    `🛒 Savatda sizni kutmoqda: ${items}${more > 0 ? ` va yana ${more} ta` : ""}${total ? ` — jami ${total}` : ""}. Buyurtmani istalgan vaqtda rasmiylashtirishingiz mumkin.`,
  openCartBtn: "🛒 Savatni ochish",
  fulfillmentReminder: (no, d) => `⏰ Eslatma: #${no} buyurtma ertaga, ${d} kuni olinadi.`,
  courseNewLesson: (no, title) => `📚 ${no}-dars ochildi: «${title}».`,
  courseOpenBtn: "Kursni ochish",
  coursePreStart: (course, days, date) =>
    `⏳ «${course}» kursi ${days === 1 ? "ertaga" : `${days} kundan keyin`} boshlanadi — ${date}. Birinchi dars shu yerga keladi.`,
  courseLiveDay: (course, title, when) =>
    `🎥 «${course}» kursi bo‘yicha tez orada efir: «${title}» — ${when}. Havola boshlanishidan bir soat oldin keladi.`,
  courseLiveHour: (course, title, when) =>
    `🎥 «${course}» kursi bo‘yicha efirga bir soat qoldi: «${title}» — ${when}.`,
  courseLiveJoinBtn: "Efirga kirish",
  courseLiveRec: (course, title, when) =>
    `▶️ Efir yozuvi tayyor: «${title}» (${when}), «${course}» kursi.`,
  courseLiveWatchBtn: "Yozuvni ko‘rish",
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
  listNumberHint:
    "Ochish uchun ro‘yxatdagi raqamni yozing — masalan, 1. Agar bu sotuvchiga savol bo‘lsa, uni yana bir bor yozing — yetkazaman.",
  catalog: "📚 Katalog",
  search: "🔍 Qidirish",
  cart: "🛒 Savat",
  myOrders: "📋 Buyurtmalarim",
  myCourses: "🎓 Kurslarim",
  catalogCourses: "📚 Barcha kurslar",
  instruction: "📖 Yo‘riqnoma",
  information: "ℹ️ Ma’lumot",
  catalogHeader: "📚 Kategoriyani tanlang:",
  addToCartBtn: "➕ Savatga qo‘shish",
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
  plusWhichProduct: "Qaysi material qiziqtiradi? Nomini yozing yoki katalogni oching 👇",
  nativeCartForwarded:
    "Katalogdan yig‘ilgan savatingizni oldim va sotuvchiga uzatdim — u buyurtmani tasdiqlab, shu yerda yozadi.",
  deliveryLinksExpire: "Fayl havolalari 7 kun amal qiladi.",
  downloadBtn: "📥 Yuklab olish",
  deliveryOrderPage: "Buyurtmaning barcha fayllari — sahifada:",
};

export const COPY: Record<Locale, Msg> = { ru, kk, en, uz };

/** «Минимальная сумма заказа — …, добавьте ещё на …» — одним текстом для бота и Instagram/WhatsApp. */
/** Подсказка про бесплатную доставку для корзины: сколько добрать или «уже бесплатно». */
export function freeDeliveryText(
  m: Pick<Msg, "freeDeliveryLeft" | "freeDeliveryReached">,
  st: { threshold: number; remaining: number; free: boolean; currency: string },
): string {
  const from = formatMoney(st.threshold, st.currency);
  return st.free
    ? m.freeDeliveryReached(from)
    : m.freeDeliveryLeft(formatMoney(st.remaining, st.currency), from);
}

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
  | "myTickets"
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
    if (t === m.myTicketsBtn) return "myTickets";
  }
  if (contactLabels.includes(t)) return "contact";
  return undefined;
}

const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Слово «каталог», «корзина», «мои заказы» (в любом регистре и без значка) —
 * то же, что нажатие кнопки меню. Только для свободного текста вне шага: без
 * этого слово «каталог» уходило в поиск товаров с таким названием.
 */
export function menuWordFor(text: string | undefined): MenuAction | undefined {
  if (!text) return undefined;
  const t = letters(text);
  if (!t) return undefined;
  for (const m of Object.values(COPY)) {
    if (t === letters(m.catalog)) return "catalog";
    if (t === letters(m.cart)) return "cart";
    if (t === letters(m.myOrders)) return "myOrders";
  }
  return undefined;
}

/** Языковые теги для дат в сообщениях покупателю. */
export const DATE_LOCALE: Record<string, string> = {
  ru: "ru-RU",
  kk: "kk-KZ",
  en: "en-GB",
  uz: "uz-UZ",
};

/** Дата отправки предзаказа `YYYY-MM-DD` словами («15 октября 2026 г.»), как на витрине. */
export function preorderDate(from: string, locale: Locale): string {
  return new Date(`${from}T12:00:00Z`).toLocaleDateString(DATE_LOCALE[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * «Мои обращения» текстом для бота (html — HTML Telegram) и Direct/WhatsApp
 * (обычный текст): номер, статус, дата последнего движения и тема.
 */
export function myTicketsText(
  m: Msg,
  list: {
    tickets: {
      number: number;
      status: "open" | "waiting" | "closed";
      subject: string;
      updatedAt: string;
    }[];
    more: number;
    canAppend: boolean;
  },
  opts: { html: boolean; date: (iso: string) => string },
): string {
  const esc = opts.html ? escapeHtml : (x: string) => x;
  if (!list.tickets.length) return m.myTicketsEmpty;
  const head = opts.html ? `<b>${m.myTicketsTitle}</b>` : m.myTicketsTitle;
  const lines = list.tickets.map(
    (t) =>
      `#${t.number} · ${m.ticketStatus(t.status)} · ${opts.date(t.updatedAt)}\n${esc(t.subject)}`,
  );
  return [
    `🆘 ${head}`,
    ...lines,
    ...(list.more ? [m.myTicketsMore(list.more)] : []),
    ...(list.canAppend && !opts.html ? [m.myTicketsAppendHint] : []),
  ].join("\n\n");
}

/** Текст напоминания о корзине — один для рассылки покупателю и для предпросмотра продавцу. */
export function cartReminderBody(
  locale: Locale,
  lines: readonly { name: string; quantity: number }[],
  more: number,
  total: string | null,
): string {
  return COPY[locale].cartReminderItems(
    lines.map((l) => (l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name)).join(", "),
    more,
    total,
  );
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

/** Кнопка и подсказка Продамуса: форма в рублях — «Карта РФ / СБП», иначе (KZ) — просто картой. */
/** Строка «карта любой страны, в том числе РФ» — только для кассы не в рублях (форма *.kz). */
export function prodamusAnyCardLine(m: Msg, kassaCurrency: string | null | undefined): string {
  return (kassaCurrency ?? "").toUpperCase() === "RUB" ? "" : m.cardAnyCountryLine;
}

export function prodamusCopy(
  m: Msg,
  kassaCurrency: string | null | undefined,
  orderCurrency?: string | null,
) {
  const kassa = (kassaCurrency ?? "").toUpperCase();
  if (kassa === "RUB") return { btn: m.payViaProdamusBtn, hint: m.prodamusHint };
  // Заказ в рублях через форму в тенге (*.kz): платят картой РФ, форма покажет тенге.
  if ((orderCurrency ?? "").toUpperCase() === "RUB")
    return { btn: m.payViaProdamusBtn, hint: m.prodamusRubViaKztHint };
  return { btn: m.payByCardBtn, hint: m.prodamusCardHint };
}

/**
 * Сумма к оплате Продамусом. Касса в рублях, заказ в тенге — «259 ₽ (1500 ₸)»;
 * заказ в рублях через форму в тенге — «490 ₽ (в форме оплаты — 1750 ₸)».
 */
export function prodamusSum(
  m: Msg,
  link: { amount: number; currency: string },
  due: number,
  orderCurrency: string,
): string {
  const order = orderCurrency.toUpperCase();
  if (link.currency.toUpperCase() === order) return formatMoney(due, orderCurrency);
  if (order === "RUB")
    return `${formatMoney(due, orderCurrency)} (${m.prodamusFormSum(formatMoney(link.amount, link.currency))})`;
  return `${formatMoney(link.amount, link.currency)} (${formatMoney(due, orderCurrency)})`;
}

/** Кнопка ручной оплаты: в реквизитах Kaspi — так и пишем, иначе общий «перевод по реквизитам». */
export function manualPayBtn(m: Msg, instructions: string | null | undefined): string {
  return /kaspi|каспи/i.test(instructions ?? "") ? m.payKaspiBtn : m.payManualBtn;
}
