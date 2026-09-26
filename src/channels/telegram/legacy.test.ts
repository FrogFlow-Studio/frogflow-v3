import { describe, expect, it } from "vitest";
import { legacyLangItem, parseLegacyLang, parseSearchMore, searchPage } from "./legacy";

describe("кнопки прежней платформы: язык материалов lang_<язык>:<заказ>:<позиция>", () => {
  it("разбирает язык, заказ и номер позиции", () => {
    expect(parseLegacyLang("lang_kk:1520:0")).toEqual({ lang: "kk", orderId: 1520, index: 0 });
    expect(parseLegacyLang("lang_ru:7:3")).toEqual({ lang: "ru", orderId: 7, index: 3 });
  });

  it("чужой формат и мусор — не кнопка v1", () => {
    expect(parseLegacyLang("lang:15:abc:kk")).toBeNull(); // формат v2
    expect(parseLegacyLang("lang_xx:15:0")).toBeNull(); // незнакомый язык
    expect(parseLegacyLang("lang_kk:abc:0")).toBeNull();
    expect(parseLegacyLang("lang_kk:15:-1")).toBeNull();
    expect(parseLegacyLang("lang_kk:15")).toBeNull();
  });

  it("позиция ищется как в v1: по индексу среди позиций, отсортированных по id строкой", () => {
    const items = [{ id: "c-3" }, { id: "a-1" }, { id: "b-2" }];
    expect(legacyLangItem(items, 0)?.id).toBe("a-1");
    expect(legacyLangItem(items, 2)?.id).toBe("c-3");
    expect(legacyLangItem(items, 3)).toBeNull();
    // Исходный порядок не меняется.
    expect(items.map((i) => i.id)).toEqual(["c-3", "a-1", "b-2"]);
  });
});

describe("поиск по страницам: searchmore:<сдвиг>", () => {
  it("разбирает сдвиг, мусор — с начала", () => {
    expect(parseSearchMore("searchmore:10")).toBe(10);
    expect(parseSearchMore("searchmore:")).toBe(0);
    expect(parseSearchMore("searchmore:-5")).toBe(0);
    expect(parseSearchMore("searchmore:abc")).toBe(0);
  });

  it("страница по 5 и следующий сдвиг, пока есть ещё", () => {
    expect(searchPage(12, 0, 5)).toEqual({ from: 0, to: 5, next: 5 });
    expect(searchPage(12, 5, 5)).toEqual({ from: 5, to: 10, next: 10 });
    expect(searchPage(12, 10, 5)).toEqual({ from: 10, to: 12, next: null });
    expect(searchPage(5, 0, 5)).toEqual({ from: 0, to: 5, next: null });
    expect(searchPage(3, 20, 5)).toEqual({ from: 3, to: 3, next: null });
  });
});
