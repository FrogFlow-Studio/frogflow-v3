import { describe, expect, it } from "vitest";
import { maskEmail, maskEmailsIn, maskPhone, truncate } from "./log-mask";

describe("truncate", () => {
  it("не трогает короткий текст", () => {
    expect(truncate("привет", 80)).toBe("привет");
  });

  it("обрезает длинный текст и добавляет многоточие", () => {
    expect(truncate("а".repeat(100), 10)).toBe(`${"а".repeat(10)}…`);
  });

  it("пустое/отсутствующее значение — пустая строка", () => {
    expect(truncate(null)).toBe("");
    expect(truncate(undefined)).toBe("");
    expect(truncate("")).toBe("");
  });
});

describe("maskEmail", () => {
  it("оставляет домен и первую букву", () => {
    expect(maskEmail("ivan@example.com")).toBe("i***@example.com");
  });

  it("без @ — полностью маскирует", () => {
    expect(maskEmail("notanemail")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });

  it("пустое значение — пустая строка", () => {
    expect(maskEmail(null)).toBe("");
  });

  it("адрес внутри ответа почтового сервера маскируется", () => {
    expect(maskEmailsIn("550 5.1.1 <ivan.petrov+shop@mail.ru>: Recipient address rejected")).toBe(
      "550 5.1.1 <i***@mail.ru>: Recipient address rejected",
    );
  });
});

describe("maskPhone", () => {
  it("оставляет последние 4 цифры", () => {
    expect(maskPhone("+7 701 234 56 78")).toBe("***5678");
  });

  it("слишком короткий номер — полностью маскирует", () => {
    expect(maskPhone("12")).toBe("***");
  });

  it("пустое значение — пустая строка", () => {
    expect(maskPhone(undefined)).toBe("");
  });
});
