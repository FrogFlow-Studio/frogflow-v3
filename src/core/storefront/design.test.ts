import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, parseDesign, photoFrame, themeClass } from "./design";

describe("оформление витрины", () => {
  it("по умолчанию — свежая тема, без обложки и блоков", () => {
    expect(parseDesign(undefined)).toEqual(DEFAULT_DESIGN);
    expect(parseDesign("мусор")).toEqual(DEFAULT_DESIGN);
  });
  it("оставляет известное и убирает неизвестное и повторы, порядок сохраняет", () => {
    expect(
      parseDesign({ theme: "warm", cover: true, blocks: ["reviews", "x", "new", "reviews", 3] }),
    ).toEqual({ theme: "warm", cover: true, blocks: ["reviews", "new"], photo: "square" });
    expect(parseDesign({ theme: "neon", cover: "yes" })).toEqual(DEFAULT_DESIGN);
  });
  it("класс темы: у темы по умолчанию его нет", () => {
    expect(themeClass("fresh")).toBe("");
    expect(themeClass("classic")).toBe("shop-theme-classic");
  });
  it("форма фото: по умолчанию квадрат, известные значения сохраняются", () => {
    expect(parseDesign({}).photo).toBe("square");
    expect(parseDesign({ photo: "portrait" }).photo).toBe("portrait");
    expect(parseDesign({ photo: "contain", theme: "warm" })).toMatchObject({
      theme: "warm",
      photo: "contain",
    });
    expect(parseDesign({ photo: "circle" }).photo).toBe("square");
    expect(parseDesign({ photo: 1 }).photo).toBe("square");
  });
  it("рамка фото: квадрат обрезает, 4:5 и «целиком» — без обрезки", () => {
    expect(photoFrame("square").img).toContain("aspect-square");
    expect(photoFrame("square").img).toContain("object-cover");
    expect(photoFrame("portrait").img).toContain("aspect-[4/5]");
    expect(photoFrame("portrait").img).toContain("object-contain");
    expect(photoFrame("portrait").img).not.toContain("aspect-square");
    expect(photoFrame("portrait").box).toBe("aspect-[4/5]");
    expect(photoFrame("contain").img).toContain("aspect-square");
    expect(photoFrame("contain").img).toContain("object-contain");
  });
});
