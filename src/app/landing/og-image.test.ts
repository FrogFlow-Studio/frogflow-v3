import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OG_IMAGE_META } from "./config";

describe("картинка превью ссылок платформы", () => {
  it("public/og.png есть и её размер совпадает с og:image:width/height", () => {
    const png = readFileSync(new URL("../../../public/og.png", import.meta.url));
    const meta = (p: string) => OG_IMAGE_META.find((m) => m.property === p)?.content;
    expect(meta("og:image")).toBe("https://www.frogflow.tech/og.png");
    expect(String(png.readUInt32BE(16))).toBe(meta("og:image:width"));
    expect(String(png.readUInt32BE(20))).toBe(meta("og:image:height"));
  });
});
