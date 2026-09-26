import type { Locale } from "@/core/i18n/locale";

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
  clearBtn: string;
  cartCleared: string;
  promoCodeBtn: string;
  removePromoBtn: string;
  promoCodePrompt: string;
  promoCodeInvalid: string;
  promoCodeRemoved: string;
  discountLine: (amount: string) => string;
  usePointsBtn: string;
  removePointsBtn: string;
  pointsBalanceLine: (n: number) => string;
  pointsDiscountLine: (amount: string) => string;
  pointsEarned: (n: number) => string;
  giftCertificateBtn: string;
  removeGiftCertificateBtn: string;
  giftCertificateCodePrompt: string;
  giftCertificateInvalid: string;
  giftCertificateRemoved: string;
  giftCertificateDiscountLine: (amount: string) => string;
  orderPaidByDiscounts: (no: number) => string;
  fulfillmentTypePrompt: string;
  fulfillmentTypePickupBtn: string;
  fulfillmentTypeDeliveryBtn: string;
  fulfillmentDatePrompt: (minDate: string) => string;
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
  payViaRobokassaBtn: string;
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
  proofReceived: (no: number) => string;
  proofDuplicate: string;
  proofFailed: string;
  proofOrderClosed: string;
  orderDelivered: (no: number) => string;
  orderRejected: (no: number) => string;
  searchPrompt: string;
  searchNothing: (q: string) => string;
  searchResults: (q: string, n: number) => string;
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
  reviewNotAllowed: string;
  noReviewableProducts: string;
  inviteFriendBtn: string;
  referralWelcome: (percent: number, code: string) => string;
  referralReward: (percent: number, code: string) => string;
  cartReminder: string;
  openCartBtn: string;
  fulfillmentReminder: (no: string, date: string) => string;
  broadcastPick: string;
  openCatalogBtn: string;
  yourId: (id: number) => string;
  fileLink: string;
  fileLinkTtl: string;
  chooseDeliveryLanguage: string;
  allLanguagesBtn: (n: number) => string;
  chooseItemLanguage: (name: string) => string;
  fileAlreadySent: string;
};

const ru: Msg = {
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
  reviewSaved: "✅ Спасибо за оценку! Хотите добавить комментарий — просто напишите его.",
  reviewSkipBtn: "Пропустить",
  reviewCommentSaved: "✅ Комментарий сохранён. Спасибо за отзыв!",
  reviewNotAllowed: "⚠️ Оценить можно только то, что вы реально купили и получили.",
  noReviewableProducts: "В этом заказе нет товаров, которые можно оценить.",
  inviteFriendBtn: "🎁 Пригласить друга",
  referralWelcome: (p, c) =>
    `🎁 Вам подарок за переход по приглашению — промокод на скидку ${p}% на первую покупку: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Ваш приглашённый друг совершил первую покупку! Промокод на скидку ${p}% для вас: <code>${c}</code>`,
  cartReminder:
    "🛒 Вы оставили товары в корзине — они всё ещё вас ждут! Оформить заказ можно в любой момент.",
  openCartBtn: "🛒 Открыть корзину",
  fulfillmentReminder: (no, d) => `⏰ Напоминаем: заказ #${no} — получение завтра, ${d}.`,
  broadcastPick: "👇 Выберите материал:",
  openCatalogBtn: "📚 Открыть каталог",
  chooseLanguage: "Выберите язык",
  languageSaved: "✅ Язык сохранён.",
  chooseSection: "Выберите раздел:",
  catalog: "📚 Каталог",
  search: "🔍 Поиск",
  cart: "🛒 Корзина",
  myOrders: "📋 Мои заказы",
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
  clearBtn: "🗑 Очистить",
  cartCleared: "Корзина очищена.",
  promoCodeBtn: "🎟 Ввести промокод",
  removePromoBtn: "❌ Убрать промокод",
  promoCodePrompt: "Введите промокод:",
  promoCodeInvalid: "⚠️ Промокод недействителен или больше не работает.",
  promoCodeRemoved: "Промокод убран.",
  discountLine: (a) => `🎟 Скидка по промокоду: −${a}\n`,
  usePointsBtn: "🏆 Списать баллы",
  removePointsBtn: "❌ Не списывать баллы",
  pointsBalanceLine: (n) => `🏆 Ваши баллы: ${n}\n`,
  pointsDiscountLine: (a) => `🏆 Оплата баллами: −${a}\n`,
  pointsEarned: (n) =>
    `🏆 Вам начислено ${n} баллов за покупку. Баллами можно оплатить часть следующего заказа.`,
  giftCertificateBtn: "🎫 Ввести сертификат",
  removeGiftCertificateBtn: "❌ Убрать сертификат",
  giftCertificateCodePrompt: "Введите код подарочного сертификата:",
  giftCertificateInvalid: "⚠️ Сертификат недействителен или уже использован.",
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
  payViaRobokassaBtn: "💳 Оплатить картой онлайн",
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
  proofDuplicate: "Этот чек уже был отправлен по другому заказу. Пришлите чек именно этой оплаты.",
  proofFailed: "Не удалось сохранить чек, попробуйте отправить ещё раз.",
  proofOrderClosed: "Этот заказ уже закрыт.",
  orderDelivered: (no) => `🎉 Заказ #${no} выдан. Спасибо за покупку!`,
  orderRejected: (no) => `❌ Заказ #${no} отклонён продавцом. Если это ошибка — напишите ему.`,
  searchPrompt: "🔍 Введите слово для поиска по каталогу:",
  searchNothing: (q) => `По запросу «${q}» ничего не найдено.`,
  searchResults: (q, n) => `🔍 «${q}»: найдено ${n}`,
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
  reviewSaved: "✅ Бағалағаныңыз үшін рақмет! Пікір қосқыңыз келсе — жай ғана жазыңыз.",
  reviewSkipBtn: "Өткізіп жіберу",
  reviewCommentSaved: "✅ Пікір сақталды. Пікіріңіз үшін рақмет!",
  reviewNotAllowed: "⚠️ Тек нақты сатып алып, алған тауарды ғана бағалауға болады.",
  noReviewableProducts: "Бұл тапсырыста бағалауға болатын тауар жоқ.",
  inviteFriendBtn: "🎁 Досты шақыру",
  referralWelcome: (p, c) =>
    `🎁 Шақыру сілтемесі бойынша өткеніңіз үшін сыйлық — алғашқы сатып алуға ${p}% жеңілдік промокоды: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Сіз шақырған дос алғашқы сатып алуын жасады! Сізге ${p}% жеңілдік промокоды: <code>${c}</code>`,
  cartReminder:
    "🛒 Себетте тауарлар қалды — олар әлі де сізді күтуде! Тапсырысты кез келген уақытта рәсімдей аласыз.",
  openCartBtn: "🛒 Себетті ашу",
  fulfillmentReminder: (no, d) => `⏰ Еске саламыз: №${no} тапсырысты алу ертең, ${d}.`,
  broadcastPick: "👇 Материалды таңдаңыз:",
  openCatalogBtn: "📚 Каталогты ашу",
  chooseLanguage: "Тілді таңдаңыз",
  chooseDeliveryLanguage: "🌐 Материалдарды қай тілде алғыңыз келеді?",
  allLanguagesBtn: (n) => `Барлық тілдер ×${n}`,
  chooseItemLanguage: (name) => `📚 «<b>${name}</b>» материалы\nФайлды қай тілде алғыңыз келеді:`,
  fileAlreadySent: "Бұл файл таңдалған тілде жіберілген.",
  languageSaved: "✅ Тіл сақталды.",
  chooseSection: "Бөлімді таңдаңыз:",
  catalog: "📚 Каталог",
  search: "🔍 Іздеу",
  cart: "🛒 Себет",
  myOrders: "📋 Тапсырыстарым",
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
  clearBtn: "🗑 Тазалау",
  promoCodeBtn: "🎟 Промокод енгізу",
  removePromoBtn: "❌ Промокодты алып тастау",
  promoCodeInvalid: "⚠️ Промокод жарамсыз немесе енді жұмыс істемейді.",
  usePointsBtn: "🏆 Баллдарды жұмсау",
  removePointsBtn: "❌ Баллдарды жұмсамау",
  giftCertificateBtn: "🎫 Сертификат енгізу",
  removeGiftCertificateBtn: "❌ Сертификатты алып тастау",
  giftCertificateInvalid: "⚠️ Сертификат жарамсыз немесе бұрын пайдаланылған.",
  chooseCountry: "🌍 Төлем елін таңдаңыз:",
  useMenu: "Төмендегі мәзірден бөлімді таңдаңыз 👇",
  nativeCartForwarded:
    "Каталогтан жиналған себетіңізді алдым және сатушыға бердім — ол тапсырысты растап, осында жазады.",
};

const en: Msg = {
  ...ru,
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
  reviewSaved: "✅ Thanks for the rating! Want to add a comment — just type it.",
  reviewSkipBtn: "Skip",
  reviewCommentSaved: "✅ Comment saved. Thanks for the review!",
  reviewNotAllowed: "⚠️ You can only rate something you actually bought and received.",
  noReviewableProducts: "This order has no products you can rate.",
  inviteFriendBtn: "🎁 Invite a friend",
  referralWelcome: (p, c) =>
    `🎁 A gift for joining via an invitation — a ${p}% discount code for your first purchase: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Your invited friend made their first purchase! Here is a ${p}% discount code for you: <code>${c}</code>`,
  cartReminder:
    "🛒 You left some items in your cart — they're still waiting for you! You can check out anytime.",
  openCartBtn: "🛒 Open cart",
  fulfillmentReminder: (no, d) => `⏰ Reminder: order #${no} — pickup/delivery is tomorrow, ${d}.`,
  broadcastPick: "👇 Pick an item:",
  openCatalogBtn: "📚 Open catalog",
  chooseLanguage: "Choose your language",
  chooseDeliveryLanguage: "🌐 Which language should the files be in?",
  allLanguagesBtn: (n) => `All languages ×${n}`,
  chooseItemLanguage: (name) => `📚 «<b>${name}</b>»\nChoose the language for the file:`,
  fileAlreadySent: "This file has already been sent in that language.",
  languageSaved: "✅ Language saved.",
  chooseSection: "Choose a section:",
  catalog: "📚 Catalog",
  search: "🔍 Search",
  cart: "🛒 Cart",
  myOrders: "📋 My orders",
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
  clearBtn: "🗑 Clear",
  promoCodeBtn: "🎟 Enter promo code",
  removePromoBtn: "❌ Remove promo code",
  promoCodePrompt: "Enter your promo code:",
  promoCodeInvalid: "⚠️ This promo code is invalid or no longer works.",
  promoCodeRemoved: "Promo code removed.",
  discountLine: (a) => `🎟 Promo discount: −${a}\n`,
  usePointsBtn: "🏆 Use points",
  removePointsBtn: "❌ Don't use points",
  pointsBalanceLine: (n) => `🏆 Your points: ${n}\n`,
  pointsDiscountLine: (a) => `🏆 Paid with points: −${a}\n`,
  pointsEarned: (n) => `🏆 You earned ${n} points. Use them on your next order.`,
  giftCertificateBtn: "🎫 Enter certificate code",
  removeGiftCertificateBtn: "❌ Remove certificate",
  giftCertificateCodePrompt: "Enter your gift certificate code:",
  giftCertificateInvalid: "⚠️ This certificate is invalid or already used.",
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
  reviewSaved: "✅ Baholaganingiz uchun rahmat! Izoh qo‘shmoqchi bo‘lsangiz — shunchaki yozing.",
  reviewSkipBtn: "O‘tkazib yuborish",
  reviewCommentSaved: "✅ Izoh saqlandi. Fikringiz uchun rahmat!",
  reviewNotAllowed: "⚠️ Faqat haqiqatan sotib olib, qo‘lga kiritgan mahsulotni baholash mumkin.",
  noReviewableProducts: "Bu buyurtmada baholash mumkin bo‘lgan mahsulot yo‘q.",
  inviteFriendBtn: "🎁 Do‘stni taklif qilish",
  referralWelcome: (p, c) =>
    `🎁 Taklif havolasi orqali o‘tganingiz uchun sovg‘a — birinchi xaridga ${p}% chegirma promokodi: <code>${c}</code>`,
  referralReward: (p, c) =>
    `🎉 Siz taklif qilgan do‘stingiz birinchi xaridini qildi! Sizga ${p}% chegirma promokodi: <code>${c}</code>`,
  cartReminder:
    "🛒 Savatda mahsulotlar qoldi — ular hali ham sizni kutmoqda! Buyurtmani istalgan vaqtda rasmiylashtirishingiz mumkin.",
  openCartBtn: "🛒 Savatni ochish",
  fulfillmentReminder: (no, d) => `⏰ Eslatma: #${no} buyurtma ertaga, ${d} kuni olinadi.`,
  broadcastPick: "👇 Materialni tanlang:",
  openCatalogBtn: "📚 Katalogni ochish",
  chooseLanguage: "Tilni tanlang",
  chooseDeliveryLanguage: "🌐 Materiallarni qaysi tilda olishni xohlaysiz?",
  allLanguagesBtn: (n) => `Barcha tillar ×${n}`,
  chooseItemLanguage: (name) => `📚 «<b>${name}</b>»\nFaylni qaysi tilda olishni tanlang:`,
  fileAlreadySent: "Bu fayl tanlangan tilda allaqachon yuborilgan.",
  languageSaved: "✅ Til saqlandi.",
  chooseSection: "Bo‘limni tanlang:",
  catalog: "📚 Katalog",
  search: "🔍 Qidirish",
  cart: "🛒 Savat",
  myOrders: "📋 Buyurtmalarim",
  instruction: "📖 Yo‘riqnoma",
  information: "ℹ️ Ma’lumot",
  catalogHeader: "📚 Kategoriyani tanlang:",
  addToCartBtn: "🛒 Savatga",
  added: "✅ Savatga qo‘shildi",
  cartEmpty: "🛒 Savat bo‘sh.",
  total: (a) => `\n<b>Jami: ${a}</b>`,
  checkoutBtn: "✅ Buyurtma berish",
  clearBtn: "🗑 Tozalash",
  promoCodeBtn: "🎟 Promokod kiritish",
  removePromoBtn: "❌ Promokodni olib tashlash",
  promoCodeInvalid: "⚠️ Promokod amal qilmaydi yoki endi ishlamaydi.",
  usePointsBtn: "🏆 Ballarni sarflash",
  removePointsBtn: "❌ Ballarni sarflamaslik",
  giftCertificateBtn: "🎫 Sertifikat kodini kiritish",
  removeGiftCertificateBtn: "❌ Sertifikatni olib tashlash",
  useMenu: "Quyidagi menyudan bo‘limni tanlang 👇",
  nativeCartForwarded:
    "Katalogdan yig‘ilgan savatingizni oldim va sotuvchiga uzatdim — u buyurtmani tasdiqlab, shu yerda yozadi.",
};

export const COPY: Record<Locale, Msg> = { ru, kk, en, uz };

export type MenuAction =
  "catalog" | "search" | "cart" | "myOrders" | "instruction" | "information" | "contact";

/** Текст кнопки меню на любом языке → каноническое действие. */
export function menuActionFor(
  text: string | undefined,
  contactLabels: string[],
): MenuAction | undefined {
  if (!text) return undefined;
  const t = text.trim();
  for (const m of Object.values(COPY)) {
    if (t === m.catalog) return "catalog";
    if (t === m.search) return "search";
    if (t === m.cart) return "cart";
    if (t === m.myOrders) return "myOrders";
    if (t === m.instruction) return "instruction";
    if (t === m.information) return "information";
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
