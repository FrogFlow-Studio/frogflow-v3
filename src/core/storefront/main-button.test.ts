import { describe, expect, it } from "vitest";
import { telegramMainButton } from "./main-button";

const labels = { buy: "Купить", add: "В корзину", checkout: "Оформить" };

describe("главная кнопка Mini App", () => {
  it("вне Telegram не показывается", () => {
    expect(
      telegramMainButton({
        inTelegram: false,
        pathname: "/s/shop/p/1",
        slug: "shop",
        cartCount: 1,
        offerOpen: true,
        canAdd: true,
        labels,
      }).visible,
    ).toBe(false);
  });

  it("на карточке с ценой на 72 часа — купить, без неё — в корзину", () => {
    const base = {
      inTelegram: true,
      pathname: "/s/shop/p/abc",
      slug: "shop",
      cartCount: 0,
      canAdd: true,
      labels,
    };
    expect(telegramMainButton({ ...base, offerOpen: true }).action).toBe("buy");
    expect(telegramMainButton({ ...base, offerOpen: false }).action).toBe("add");
  });

  it("в корзине с товаром — оформить, пустая корзина кнопку прячет", () => {
    expect(
      telegramMainButton({
        inTelegram: true,
        pathname: "/s/shop/cart",
        slug: "shop",
        cartCount: 2,
        offerOpen: false,
        canAdd: false,
        labels,
      }).action,
    ).toBe("checkout");
    expect(
      telegramMainButton({
        inTelegram: true,
        pathname: "/s/shop/cart/",
        slug: "shop",
        cartCount: 0,
        offerOpen: false,
        canAdd: false,
        labels,
      }).visible,
    ).toBe(false);
  });
});
