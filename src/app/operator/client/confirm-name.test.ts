import { describe, expect, it } from "vitest";
import { CLIENT_TABS, nameMatches, parseTab } from "./confirm-name";

describe("подтверждение вводом названия", () => {
  it("совпадение без учёта регистра и лишних пробелов", () => {
    expect(nameMatches("кондитерская  Д14 ", "Кондитерская Д14")).toBe(true);
    expect(nameMatches("Кондитерская Д14", "Кондитерская Д14")).toBe(true);
  });
  it("другое название, часть названия и пустой ввод не подходят", () => {
    expect(nameMatches("Кондитерская", "Кондитерская Д14")).toBe(false);
    expect(nameMatches("", "Кондитерская Д14")).toBe(false);
    expect(nameMatches("Кондитерская Д14!", "Кондитерская Д14")).toBe(false);
  });
  it("у клиента без названия подтвердить нельзя ничем, даже пустой строкой", () => {
    expect(nameMatches("", "")).toBe(false);
    expect(nameMatches("   ", "  ")).toBe(false);
  });
});

describe("вкладки карточки клиента", () => {
  it("пять вкладок в заданном порядке", () => {
    expect(CLIENT_TABS.map((t) => t.title)).toEqual([
      "Обзор",
      "Каналы",
      "Оплата",
      "Журнал",
      "Переезд",
    ]);
  });
  it("неизвестная вкладка в адресе — «Обзор»", () => {
    expect(parseTab("billing")).toBe("billing");
    expect(parseTab("hack")).toBe("overview");
    expect(parseTab(undefined)).toBe("overview");
  });
});
