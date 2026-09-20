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
  status: Record<string, string>;
  instructionDefault: string;
  infoText: string;
  contactAuthor: (link: string) => string;
  contactNotSet: string;
  useMenu: string;
  yourId: (id: number) => string;
  fileLink: string;
  fileLinkTtl: string;
};

const ru: Msg = {
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
  yourId: (id) => `Ваш Telegram ID: <code>${id}</code>`,
  fileLink: "📥 Нажмите здесь, чтобы скачать файл",
  fileLinkTtl: "Ссылка действует 7 дней",
};

const kk: Msg = {
  ...ru,
  chooseLanguage: "Тілді таңдаңыз",
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
};

const en: Msg = {
  ...ru,
  chooseLanguage: "Choose your language",
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
};

const uz: Msg = {
  ...ru,
  chooseLanguage: "Tilni tanlang",
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
