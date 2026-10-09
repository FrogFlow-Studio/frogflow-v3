import { describe, expect, it } from "vitest";
import { cleanReply, hasToolMarkup, stripToolMarkup } from "./prompt";

/** BOVI 30.09: покупателю ушёл вызов поиска текстом вместо ответа. */
const LEAK =
  '<invoke name="search_products">\n<parameter name="query">Kleen Crystal</parameter>\n</invoke>';

describe("разметка вызова инструмента в ответе", () => {
  it("узнаётся и вырезается целиком", () => {
    expect(hasToolMarkup(LEAK)).toBe(true);
    expect(stripToolMarkup(LEAK)).toBe("");
    expect(cleanReply(LEAK)).toBe("");
  });

  it("текст вокруг вызова остаётся", () => {
    const text = `Сейчас посмотрю.\n<function_calls>\n${LEAK}\n</function_calls>\nЕсть коврики Kleen-Tex.`;
    expect(stripToolMarkup(text)).toBe("Сейчас посмотрю.\n\nЕсть коврики Kleen-Tex.");
  });

  it("незакрытый вызов в конце обрезается", () => {
    expect(
      stripToolMarkup('Есть два варианта.\n<invoke name="search_products">\n<parameter name="q'),
    ).toBe("Есть два варианта.");
  });

  it("обычный текст не трогает", () => {
    const text = "Коврик 60x100 — 47 000 ₸. Размер <60 см тоже есть.";
    expect(hasToolMarkup(text)).toBe(false);
    expect(stripToolMarkup(text)).toBe(text);
  });
});
