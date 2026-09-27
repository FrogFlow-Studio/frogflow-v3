import { describe, expect, it } from "vitest";
import { nextSetupStep, testOrderLink } from "./setup";

const none = {
  telegram: false,
  products: false,
  payment: false,
  notifications: false,
  legal: false,
  firstOrder: false,
};

describe("мастер первого запуска", () => {
  it("следующий шаг — первый несделанный по порядку; всё сделано — null", () => {
    expect(nextSetupStep(none)).toBe("telegram");
    expect(nextSetupStep({ ...none, telegram: true, products: true })).toBe("payment");
    // Шаги можно делать не по порядку: подсвечивается самый ранний несделанный.
    expect(nextSetupStep({ ...none, telegram: true, legal: true })).toBe("products");
    const all = Object.fromEntries(Object.keys(none).map((k) => [k, true])) as typeof none;
    expect(nextSetupStep(all)).toBeNull();
  });

  it("тестовый заказ ведёт в бота продавца сразу на карточку товара", () => {
    expect(testOrderLink("my_shop_bot", "0bac1f86-5231-4e57-838d-2faa44d427e7")).toEqual({
      url: "https://t.me/my_shop_bot?start=p_0bac1f86-5231-4e57-838d-2faa44d427e7",
    });
  });

  it("без бота или без включённого товара — говорит, чего не хватает", () => {
    expect(testOrderLink(null, "p1")).toEqual({ missing: "telegram" });
    expect(testOrderLink("my_shop_bot", null)).toEqual({ missing: "products" });
    expect(testOrderLink(null, null)).toEqual({ missing: "telegram" });
  });

  it("имя бота с @ или мусором не ломает ссылку", () => {
    expect(testOrderLink("@my_shop_bot", "p1")).toEqual({
      url: "https://t.me/my_shop_bot?start=p_p1",
    });
    expect(testOrderLink("bad name/../x", "p1")).toEqual({ missing: "telegram" });
  });
});
