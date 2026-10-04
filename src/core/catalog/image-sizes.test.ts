import { describe, expect, it } from "vitest";

import { imageSrcSet, parseImageWidth } from "./image-url";

describe("размеры витринных картинок", () => {
  it("принимает только ширины из списка", () => {
    expect(parseImageWidth("640")).toBe(640);
    expect(parseImageWidth("641")).toBeNull();
    expect(parseImageWidth("99999")).toBeNull();
    expect(parseImageWidth("abc")).toBeNull();
    expect(parseImageWidth(null)).toBeNull();
  });
  it("srcset только для картинок площадки", () => {
    expect(imageSrcSet("/api/img/b/k")).toBe(
      "/api/img/b/k?w=320 320w, /api/img/b/k?w=640 640w, /api/img/b/k?w=960 960w, /api/img/b/k?w=1280 1280w",
    );
    expect(imageSrcSet("https://cdn.example.com/a.jpg")).toBeUndefined();
    expect(imageSrcSet("/api/img/b/k?w=320")).toBeUndefined();
  });
});
