import { describe, expect, it } from "vitest";
import { outboundOf, telegramButton } from "./reply";

describe("карточка в чате", () => {
  it("открывает товар в Mini App и оставляет «Купить» в чате", () => {
    const message = outboundOf(
      {
        kind: "offer",
        buyerId: "b",
        offerId: "ABCDEFGH",
        currency: "KZT",
        totalMinor: 170000,
        title: "Палитра",
        productId: "11111111-1111-4111-8111-111111111111",
      },
      "77",
      "ru",
      "https://shop.test/s/palette",
    );
    expect(message?.buttons.map((b) => telegramButton(b))).toEqual([
      {
        text: "Открыть",
        web_app: {
          url: "https://shop.test/s/palette/p/11111111-1111-4111-8111-111111111111?offer=ABCDEFGH",
        },
      },
      { text: "Купить", callback_data: "offer:ABCDEFGH" },
    ]);
  });

  it("без адреса магазина остаётся одна кнопка «Купить»", () => {
    const message = outboundOf(
      {
        kind: "offer",
        buyerId: "b",
        offerId: "ABCDEFGH",
        currency: "KZT",
        totalMinor: 170000,
        title: "Палитра",
        productId: "11111111-1111-4111-8111-111111111111",
      },
      "77",
    );
    expect(message?.buttons).toEqual([{ label: "Купить", data: "offer:ABCDEFGH" }]);
  });
});
