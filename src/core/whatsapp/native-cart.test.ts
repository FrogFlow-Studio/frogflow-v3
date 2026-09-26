import { describe, expect, it } from "vitest";
import { describeNativeCart, matchNativeItems } from "./native-cart";

const products = [
  { id: "11111111-1111-4111-8111-111111111111", name: "018. Набор карточек", keywords: null },
  { id: "22222222-2222-4222-8222-222222222222", name: "Пазлы", keywords: "236, пазлы, дети" },
];

describe("корзина из каталога Meta", () => {
  it("сопоставляет по id, номеру из названия, номеру из ключевых слов и названию", () => {
    const r = matchNativeItems(
      [
        {
          retailerId: "11111111-1111-4111-8111-111111111111",
          quantity: 2,
          price: 100,
          currency: "KZT",
        },
        { retailerId: "#18", quantity: 1, price: 100, currency: "KZT" },
        { retailerId: "236", quantity: 0, price: 50, currency: "KZT" },
        { retailerId: "пазлы", quantity: 1, price: 50, currency: "KZT" },
        { retailerId: "sku-999", quantity: 1, price: 5, currency: "KZT" },
      ],
      products,
    );
    expect(r.matched.map((m) => [m.name, m.quantity])).toEqual([
      ["018. Набор карточек", 2],
      ["018. Набор карточек", 1],
      ["Пазлы", 1],
      ["Пазлы", 1],
    ]);
    expect(r.unmatched.map((u) => u.retailerId)).toEqual(["sku-999"]);
  });
  it("текст продавцу содержит позиции, итог и комментарий", () => {
    const text = describeNativeCart(
      "@buyer",
      [{ retailerId: "sku-1", quantity: 2, price: 1500, currency: "KZT" }],
      "к вечеру",
    );
    expect(text).toContain("sku-1 × 2");
    expect(text).toContain("Итого: 3000 KZT");
    expect(text).toContain("к вечеру");
  });
});
