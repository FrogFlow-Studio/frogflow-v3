import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, parseDesign, themeClass } from "./design";

describe("оформление витрины", () => {
  it("по умолчанию — свежая тема, без обложки и блоков", () => {
    expect(parseDesign(undefined)).toEqual(DEFAULT_DESIGN);
    expect(parseDesign("мусор")).toEqual(DEFAULT_DESIGN);
  });
  it("оставляет известное и убирает неизвестное и повторы, порядок сохраняет", () => {
    expect(
      parseDesign({ theme: "warm", cover: true, blocks: ["reviews", "x", "new", "reviews", 3] }),
    ).toEqual({ theme: "warm", cover: true, blocks: ["reviews", "new"] });
    expect(parseDesign({ theme: "neon", cover: "yes" })).toEqual(DEFAULT_DESIGN);
  });
  it("класс темы: у темы по умолчанию его нет", () => {
    expect(themeClass("fresh")).toBe("");
    expect(themeClass("classic")).toBe("shop-theme-classic");
  });
});
