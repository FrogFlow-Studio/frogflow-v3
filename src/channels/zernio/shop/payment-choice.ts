export const HIDE_MANUAL_KASPI_WITH_ROBOKASSA_SETTING = "hide_manual_kaspi_with_robokassa";

export type CheckoutPaymentButton = {
  type: "postback";
  title: string;
  payload: string;
};

/** Скрывает ручной Kaspi только для арендаторов, включивших эту настройку. */
export function shouldHideManualKaspiChoice(
  instructions: string | null | undefined,
  robokassaReady: boolean,
  settingValue: string | null,
): boolean {
  return robokassaReady && settingValue === "true" && /kaspi|каспи/i.test(instructions ?? "");
}

/** Instagram показывает не больше трёх кнопок; без ручного Kaspi можно показать все онлайн-методы. */
export function checkoutPaymentButtons(
  online: readonly CheckoutPaymentButton[],
  manual: CheckoutPaymentButton,
  hideManualKaspi: boolean,
): CheckoutPaymentButton[] {
  return [...online.slice(0, hideManualKaspi ? 3 : 2), ...(hideManualKaspi ? [] : [manual])];
}
