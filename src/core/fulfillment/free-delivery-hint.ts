/**
 * Что форма оформления на сайте обещает про бесплатную доставку. Форма знает
 * только сумму корзины до скидок, а сервер решает по сумме после промокода:
 * пока в поле промокода что-то введено, «бесплатно» форма не обещает.
 */
export type FreeDeliveryHint = "left" | "reached" | "promo";

export function freeDeliveryHint(
  cartTotal: number,
  threshold: number,
  promoTyped: boolean,
): FreeDeliveryHint {
  if (cartTotal < threshold) return "left";
  return promoTyped ? "promo" : "reached";
}
