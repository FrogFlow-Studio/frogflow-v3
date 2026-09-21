import { describe, expect, it } from "vitest";
import {
  addDeliveredLanguage,
  deliveryPriceMultiplier,
  isDeliveryLangChoice,
  parseDeliveredLanguages,
} from "./materials";
import { itemNeedsLanguageChoice } from "@/core/orders/pure";

describe("isDeliveryLangChoice / deliveryPriceMultiplier", () => {
  it("признаёт конкретный язык и «all», отвергает мусор", () => {
    expect(isDeliveryLangChoice("ru")).toBe(true);
    expect(isDeliveryLangChoice("all")).toBe(true);
    expect(isDeliveryLangChoice("kz")).toBe(false);
    expect(isDeliveryLangChoice(null)).toBe(false);
  });
  it("конкретный язык — цена не меняется", () => {
    expect(deliveryPriceMultiplier("ru", 4)).toBe(1);
    expect(deliveryPriceMultiplier(null, 4)).toBe(1);
  });
  it("«все языки» — множитель равен числу языков ИМЕННО ЭТОГО товара", () => {
    expect(deliveryPriceMultiplier("all", 2)).toBe(2);
    expect(deliveryPriceMultiplier("all", 4)).toBe(4);
    expect(deliveryPriceMultiplier("all", 0)).toBe(1);
  });
});

describe("parseDeliveredLanguages / addDeliveredLanguage", () => {
  it("«both» — исторический синоним ru+kk; список через запятую; мусор — пусто", () => {
    expect([...parseDeliveredLanguages("both")].sort()).toEqual(["kk", "ru"]);
    expect([...parseDeliveredLanguages("ru, en")].sort()).toEqual(["en", "ru"]);
    expect(parseDeliveredLanguages("xx,").size).toBe(0);
    expect(parseDeliveredLanguages(null).size).toBe(0);
  });
  it("добавление языка накапливает список в порядке ru→kk→en→uz", () => {
    expect(addDeliveredLanguage(null, "kk")).toBe("kk");
    expect(addDeliveredLanguage("kk", "ru")).toBe("ru,kk");
    expect(addDeliveredLanguage("ru,kk", "kk")).toBe("ru,kk");
  });
});

describe("itemNeedsLanguageChoice", () => {
  const two = {
    material_files_by_lang: {
      ru: [{ path: "r.pdf", name: "R", url: null }],
      kk: [{ path: "k.pdf", name: "K", url: null }],
    },
  };
  const one = { material_files_by_lang: { ru: [{ path: "r.pdf", name: "R", url: null }] } };
  it("несколько языков и ничего не выбрано — ждёт; выбранный — не ждёт", () => {
    expect(itemNeedsLanguageChoice(two, true)).toBe(true);
    expect(itemNeedsLanguageChoice({ ...two, delivered_language: null }, true)).toBe(true);
    expect(itemNeedsLanguageChoice({ ...two, delivered_language: "kk" }, true)).toBe(false);
  });
  it("один язык, модуль выключен или нет файлов — вопрос не нужен", () => {
    expect(itemNeedsLanguageChoice(one, true)).toBe(false);
    expect(itemNeedsLanguageChoice(two, false)).toBe(false);
    expect(itemNeedsLanguageChoice({}, true)).toBe(false);
    expect(itemNeedsLanguageChoice(null, true)).toBe(false);
  });
});
