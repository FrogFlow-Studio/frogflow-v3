import { describe, expect, it } from "vitest";
import { checkoutPaymentButtons, type CheckoutPaymentButton } from "./payment-choice";

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
  it("рядом с Робокассой остаётся перевод Kaspi (Копилка 25.10): не больше трёх кнопок", () => {
    expect(checkoutPaymentButtons(online, manual).map((b) => b.payload)).toEqual([
      "PAY:rk",
      "PAY:pdm",
      "PAY:manual",
    ]);
  });

  it("один онлайн-способ — он и перевод", () => {
    expect(checkoutPaymentButtons([online[0]!], manual).map((b) => b.payload)).toEqual([
      "PAY:rk",
      "PAY:manual",
    ]);
  });
});
