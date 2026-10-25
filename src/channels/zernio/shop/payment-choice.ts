export type CheckoutPaymentButton = {
  type: "postback";
  title: string;
  payload: string;
};

/**
 * Кнопки оплаты: до двух онлайн-способов и ручной перевод. Instagram и
 * WhatsApp показывают не больше трёх кнопок. Ручной Kaspi не прячем рядом
 * с Робокассой (решение Якова 25.10): казахстанский покупатель выбирает сам —
 * перевод Kaspi с чеком или картой (Kaspi Gold тоже) с мгновенной выдачей.
 * Скрытие 24.10 оставило Копилке только карту и Продамус (карты РФ).
 */
export function checkoutPaymentButtons(
  online: readonly CheckoutPaymentButton[],
  manual: CheckoutPaymentButton,
): CheckoutPaymentButton[] {
  return [...online.slice(0, 2), manual];
}
