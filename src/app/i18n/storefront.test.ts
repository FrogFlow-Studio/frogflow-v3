import { describe, expect, it } from "vitest";
import { STOREFRONT_KEYS, reviewsWord, storefrontT } from "./storefront";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

describe("словарь витрины", () => {
  it("переводит с подстановкой на каждом языке", () => {
    expect(storefrontT("ru")("cart.title")).toBe("Корзина");
    expect(storefrontT("kk")("cart.title")).toBe("Себет");
    expect(storefrontT("en")("cart.title")).toBe("Cart");
    expect(storefrontT("uz")("cart.title")).toBe("Savat");
    expect(storefrontT("ru")("catalog.madeToOrder", { n: 3 })).toBe("На заказ · 3 дн.");
    expect(storefrontT("kk")("catalog.priceFrom", { price: "5 000 ₸" })).toBe("5 000 ₸ бастап");
    expect(storefrontT("en")("catalog.searchFor", { q: "cake" })).toBe("Search: “cake”");
    expect(storefrontT("uz")("product.leadTime", { n: 2 })).toBe("⏳ Tayyorlash muddati: 2 kun");
  });
  it("ни один ключ не пропущен ни в одном языке", () => {
    expect(STOREFRONT_KEYS.length).toBeGreaterThan(50);
    for (const l of SUPPORTED_LOCALES) {
      const t = storefrontT(l);
      for (const k of STOREFRONT_KEYS) {
        expect(t(k), `${l}: ${k}`).toBeTruthy();
        expect(t(k), `${l}: ${k}`).not.toBe(k);
      }
    }
  });
  it("склоняет «отзыв» по числу", () => {
    expect(reviewsWord("ru", 1)).toBe("отзыв");
    expect(reviewsWord("ru", 3)).toBe("отзыва");
    expect(reviewsWord("ru", 7)).toBe("отзывов");
    expect(reviewsWord("en", 1)).toBe("review");
    expect(reviewsWord("en", 2)).toBe("reviews");
    expect(reviewsWord("kk", 5)).toBe("пікір");
    expect(reviewsWord("uz", 5)).toBe("sharh");
  });
});
