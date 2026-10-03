import { describe, expect, it } from "vitest";
import { COPY, categoryButtonLabel, menuActionFor, normalizePhone } from "./copy";

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

describe("предзаказ в боте: дата словами, не сырым ISO", () => {
  it("подпись товара и строка корзины на каждом языке не содержат 2026-10-15", () => {
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const label = COPY[l].preorderLabel("2026-10-15");
      const note = COPY[l].preorderCartNote("2026-10-15");
      for (const t of [label, note]) {
        expect(t).not.toMatch(/2026-10-15/);
        expect(t).toMatch(/15/);
        expect(t).toMatch(/2026/);
      }
    }
    expect(COPY.ru.preorderLabel("2026-10-15")).toMatch(/октября/);
    expect(COPY.en.preorderLabel("2026-10-15")).toMatch(/October/);
  });

  it("без даты — прежний текст «срок уточним»", () => {
    expect(COPY.ru.preorderLabel(null)).toMatch(/срок отправки уточним/);
    expect(COPY.en.preorderCartNote(null)).toBe("   🕒 pre-order\n");
  });
});
