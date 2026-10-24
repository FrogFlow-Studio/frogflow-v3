import { describe, expect, it } from "vitest";
import {
  checkoutPaymentButtons,
  shouldHideManualKaspiChoice,
  type CheckoutPaymentButton,
} from "./payment-choice";

const online: CheckoutPaymentButton[] = [
  { type: "postback", title: "Оплата картой", payload: "PAY:rk" },
  { type: "postback", title: "Карта РФ", payload: "PAY:pdm" },
  { type: "postback", title: "Kaspi API", payload: "PAY:kaspi" },
];
const manual: CheckoutPaymentButton = {
  type: "postback",
  title: "Перевод Kaspi",
  payload: "PAY:manual",
};

describe("checkoutPaymentButtons", () => {
  it("скрывает ручной Kaspi только при включённой настройке и доступной Robokassa", () => {
    expect(shouldHideManualKaspiChoice("Kaspi перевод", true, "true")).toBe(true);
    expect(shouldHideManualKaspiChoice("Kaspi перевод", true, null)).toBe(false);
    expect(shouldHideManualKaspiChoice("Kaspi перевод", false, "true")).toBe(false);
    expect(shouldHideManualKaspiChoice("Перевод на счёт", true, "true")).toBe(false);
  });

  it("убирает ручную кнопку и не больше трёх онлайн-методов", () => {
    const hideManual = shouldHideManualKaspiChoice("Kaspi перевод", true, "true");
    const buttons = checkoutPaymentButtons(online, manual, hideManual);
    expect(buttons.map((button) => button.payload)).toEqual(["PAY:rk", "PAY:pdm", "PAY:kaspi"]);
  });

  it("сохраняет ручной Kaspi как fallback, если tenant flag выключен", () => {
    const hideManual = shouldHideManualKaspiChoice("Перевод Kaspi", false, null);
    const pdmOnly = [online[1]!];
    const buttons = checkoutPaymentButtons(pdmOnly, manual, hideManual);
    expect(buttons.map((button) => button.payload)).toEqual(["PAY:pdm", "PAY:manual"]);
  });

  it("не скрывает обычный перевод по реквизитам только из-за Robokassa", () => {
    const hideManual = shouldHideManualKaspiChoice("Перевод на счёт", true, "true");
    const buttons = checkoutPaymentButtons(online, manual, hideManual);
    expect(buttons.map((button) => button.payload)).toEqual(["PAY:rk", "PAY:pdm", "PAY:manual"]);
  });
});
