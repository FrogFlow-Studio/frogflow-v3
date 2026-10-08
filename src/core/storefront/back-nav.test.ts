import { describe, expect, it } from "vitest";
import { isCatalogHome, parseSearchReturn, shortQuery, telegramBack } from "./back-nav";

const UUID = "0b8e7a3c-1d2f-4a5b-8c9d-0e1f2a3b4c5d";

describe("кнопка «Назад» Telegram", () => {
  it("главная каталога — с косой чертой и без", () => {
    expect(isCatalogHome("/s/shop", "shop")).toBe(true);
    expect(isCatalogHome("/s/shop/", "shop")).toBe(true);
    expect(isCatalogHome("/s/shop/p/1", "shop")).toBe(false);
    expect(isCatalogHome("/s/shop2", "shop")).toBe(false);
  });
  it("на главной кнопки нет", () => {
    expect(
      telegramBack({ pathname: "/s/shop", slug: "shop", overlayOpen: false, canGoBack: true }),
    ).toEqual({ visible: false, action: null });
  });
  it("на остальных страницах — шаг назад по истории", () => {
    for (const pathname of ["/s/shop/p/1", "/s/shop/cart", "/s/shop/c/x", "/s/shop/checkout"])
      expect(telegramBack({ pathname, slug: "shop", overlayOpen: false, canGoBack: true })).toEqual(
        { visible: true, action: "history" },
      );
  });
  it("товар по прямой ссылке (истории нет) — в каталог, а не закрыть", () => {
    expect(
      telegramBack({ pathname: "/s/shop/p/1", slug: "shop", overlayOpen: false, canGoBack: false }),
    ).toEqual({ visible: true, action: "catalog" });
  });
  it("открыт просмотр фото — «Назад» закрывает его, даже на главной", () => {
    expect(
      telegramBack({ pathname: "/s/shop/p/1", slug: "shop", overlayOpen: true, canGoBack: true }),
    ).toEqual({ visible: true, action: "close-overlay" });
    expect(
      telegramBack({ pathname: "/s/shop", slug: "shop", overlayOpen: true, canGoBack: false }),
    ).toEqual({ visible: true, action: "close-overlay" });
  });
});

describe("возврат к результатам поиска", () => {
  it("запрос и категория", () => {
    expect(parseSearchReturn({ q: " Части речи ", cat: UUID })).toEqual({
      q: "Части речи",
      cat: UUID,
    });
    expect(parseSearchReturn({ q: "свеча" })).toEqual({ q: "свеча" });
  });
  it("без запроса, пустой, длинный — не из поиска; чужая категория отбрасывается", () => {
    expect(parseSearchReturn({})).toBeNull();
    expect(parseSearchReturn({ q: "   " })).toBeNull();
    expect(parseSearchReturn({ q: "x".repeat(201) })).toBeNull();
    expect(parseSearchReturn({ q: 5 })).toBeNull();
    expect(parseSearchReturn({ q: "a", cat: "javascript:alert(1)" })).toEqual({ q: "a" });
  });
  it("длинный запрос в подписи обрезается", () => {
    expect(shortQuery("Части речи")).toBe("Части речи");
    expect(shortQuery("a".repeat(50), 10)).toBe("aaaaaaaaa…");
  });
});
