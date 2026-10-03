import { describe, expect, it } from "vitest";
import { categoryButtonLabel, menuActionFor, normalizePhone } from "./copy";

describe("telegram copy helpers", () => {
  it("кнопка меню на любом языке → каноническое действие", () => {
    expect(menuActionFor("🛒 Себет", [])).toBe("cart");
    expect(menuActionFor("📚 Catalog", [])).toBe("catalog");
    expect(menuActionFor("💬 Связаться с автором", ["💬 Связаться с автором"])).toBe("contact");
    expect(menuActionFor("привет", [])).toBeUndefined();
  });

  it("категория с эмодзи в начале не получает второй значок", () => {
    expect(categoryButtonLabel("🎓 Курсы")).toBe("🎓 Курсы");
    expect(categoryButtonLabel(" Книги ")).toBe("📁 Книги");
  });

  it("телефон нормализуется, мусор отвергается", () => {
    expect(normalizePhone("8 (700) 123-45-67")).toBe("+87001234567");
    expect(normalizePhone("+7 700 123 45 67")).toBe("+77001234567");
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("минимальная сумма заказа: текст для покупателя", () => {
  const below = { min: 2500, shortfall: 1500, currency: "KZT" };
  it("на четырёх языках называет минимум и сколько добрать", async () => {
    const { COPY, minOrderText } = await import("./copy");
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const text = minOrderText(COPY[l], below);
      expect(text, l).toContain("2500 ₸");
      expect(text, l).toContain("1500 ₸");
    }
    expect(minOrderText(COPY.ru, below)).toBe(
      "⚠️ Минимальная сумма заказа — 2500 ₸. Добавьте товаров ещё на 1500 ₸.",
    );
  });

  it("в другой валюте — суммы в ней", async () => {
    const { COPY, minOrderText } = await import("./copy");
    expect(minOrderText(COPY.en, { min: 800, shortfall: 300, currency: "RUB" })).toBe(
      "⚠️ The minimum order is 800 ₽. Add 300 ₽ more to your cart.",
    );
  });
});
