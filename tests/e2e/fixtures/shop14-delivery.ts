/**
 * Выдача заказов (seed/shop14-delivery.ts, shop14-delivery.spec.ts): отдельный магазин
 * «Пекарня Д14» с физическим товаром, воскресеньем без выдачи; основной магазин
 * сида не меняется.
 */
export const DELIVERY_SHOP_ID = "e2e00000-0000-4000-8000-0000000000d0";
export const DELIVERY_SHOP_NAME = "Пекарня Д14";
export const DELIVERY_SHOP_SLUG = "e2e-pekarnya";
export const DELIVERY_PRODUCT_ID = "e2e00000-0000-4000-8000-0000000000d1";
export const DELIVERY_PRODUCT_NAME = "Торт Наполеон Д14";
export const DELIVERY_PRODUCT_PRICE = 8000;
/** Заказов на день у «Пекарни Д14» не больше стольких; в «занятый» день уже стоят все. */
export const DELIVERY_DAY_LIMIT = 5;
/** Занятый день: первая не воскресная дата не раньше чем через 20 дней (воскресенье — нерабочий день магазина). */
export function deliveryFullDay(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 20);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
export const DELIVERY_SELLER_LOGIN = "e2e_pekarnya";
export const DELIVERY_SELLER_PASSWORD = "e2e-pekarnya-pass-123";
