import { describe, expect, it } from "vitest";
import { isInstagramCdnUrl, parsePostCaption, parsePrice } from "./ig-import";

describe("цена из подписи поста", () => {
  it("с валютой в любой записи", () => {
    expect(parsePrice("Цена: 12 000 ₸")).toEqual({ price: 12000, currency: "KZT" });
    expect(parsePrice("всего 15.000тг!")).toEqual({ price: 15000, currency: "KZT" });
    expect(parsePrice("2500 руб.")).toEqual({ price: 2500, currency: "RUB" });
    expect(parsePrice("narxi 150 000 so'm")).toEqual({ price: 150000, currency: "UZS" });
    expect(parsePrice("$ 25")).toEqual({ price: 25, currency: "USD" });
    expect(parsePrice("9,99 usd")).toEqual({ price: 9.99, currency: "USD" });
  });

  it("«Цена: 9900» без валюты — валюта магазина; просто числа — не цена", () => {
    expect(parsePrice("Стоимость — 9900")).toEqual({ price: 9900, currency: null });
    expect(parsePrice("Торт на 12 человек, 3 яруса")).toBeNull();
  });
});

describe("черновик товара из поста", () => {
  it("название — первая строка без эмодзи и хештегов, цена, хештеги — в ключевые слова", () => {
    const d = parsePostCaption(
      "🎂 Торт «Наполеон» — классика!\nНежный крем, 1,5 кг\nЦена: 12 000 ₸\n\n#торты #Наполеон @bakery",
    );
    expect(d.name).toBe("Торт «Наполеон» — классика");
    expect(d).toMatchObject({ price: 12000, currency: "KZT", keywords: "торты наполеон" });
    expect(d.description).toContain("Нежный крем");
    expect(d.description).not.toContain("#торты");
  });

  it("первая строка — только цена: название со следующей; пустая подпись — заглушка", () => {
    expect(parsePostCaption("5000 ₸\nБукет из 15 роз").name).toBe("Букет из 15 роз");
    expect(parsePostCaption("").name).toBe("Товар из Instagram");
    expect(parsePostCaption(null).price).toBeNull();
  });

  it("фото скачивается только с CDN Instagram по https", () => {
    expect(isInstagramCdnUrl("https://scontent-arn2-1.cdninstagram.com/v/t51/1.jpg")).toBe(true);
    expect(isInstagramCdnUrl("https://scontent.xx.fbcdn.net/a.jpg")).toBe(true);
    expect(isInstagramCdnUrl("http://scontent.cdninstagram.com/a.jpg")).toBe(false);
    expect(isInstagramCdnUrl("https://evil.com/cdninstagram.com.jpg")).toBe(false);
    expect(isInstagramCdnUrl("https://127.0.0.1/a.jpg")).toBe(false);
  });
});
