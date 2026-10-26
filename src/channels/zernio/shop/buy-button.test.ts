import { describe, expect, it } from "vitest";
import { findOfferVariant } from "./buy-button";

const variants = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Папка МО ЕМН для России" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Папка МО ЕМН для Казахстана" },
];

describe("findOfferVariant: вариант кнопки «Купить»", () => {
  it("находит по id", () => {
    expect(findOfferVariant(variants, "22222222-2222-4222-8222-222222222222")?.name).toBe(
      "Папка МО ЕМН для Казахстана",
    );
  });

  it("находит по названию, как его передаёт модель (набор продаж 26.10)", () => {
    expect(findOfferVariant(variants, "  папка МО  ЕМН для казахстана ")?.id).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("чужое название и пустое значение — нет варианта", () => {
    expect(findOfferVariant(variants, "Папка ОГН")).toBeUndefined();
    expect(findOfferVariant(variants, undefined)).toBeUndefined();
    expect(findOfferVariant(variants, " ")).toBeUndefined();
  });
});
