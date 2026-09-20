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
