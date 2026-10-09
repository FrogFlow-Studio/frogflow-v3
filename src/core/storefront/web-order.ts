/**
 * Заказ с витрины сайта без мессенджера. Покупатель — обычная строка
 * bot_users с каналом `web` (ключ — отпечаток почты: повторный заказ с той
 * же почтой попадает к тому же покупателю), заказ создаёт тот же placeOrder,
 * что и в боте: номер, склад, скидки, события. Чата нет, поэтому материалы
 * «выдаются» на страницу заказа (подписанная ссылка) и копией на почту;
 * письмо — не условие выдачи: без SMTP страница заказа работает.
 *
 * Реализация — в соседних модулях `web-customer`, `web-order-access`,
 * `web-place`, `web-order-view`, `web-payment-links`.
 */
export {
  parseWebCheckout,
  WEB_CHECKOUT_KEY,
  type WebCheckoutSettings,
} from "./web-checkout-settings";
export {
  webCheckoutSettings,
  normalizeEmail,
  webCustomerId,
  webCustomer,
  telegramWebCustomer,
  rememberFirstSource,
} from "./web-customer";
export { orderAccessToken, verifyOrderAccess } from "./web-order-access";
export {
  WEB_MAX_QTY,
  type WebPlaceResult,
  placeWebOrder,
  webMaterialSender,
  deliverWebOrder,
} from "./web-place";
export {
  type WebMaterial,
  webOrderMaterials,
  type WebOrderView,
  hasOrderPage,
  orderPageUrl,
  orderDiscount,
  maskEmail,
  maskAddress,
  webOrderView,
} from "./web-order-view";
export { webCardPaymentUrl, webStripePaymentUrl, webProdamusPaymentUrl } from "./web-payment-links";
