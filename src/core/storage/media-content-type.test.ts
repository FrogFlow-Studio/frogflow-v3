import { describe, expect, it } from "vitest";
import { publicMediaContentType } from "./media-content-type";

describe("publicMediaContentType", () => {
  it.each([
    ["image/jpeg", "products/item.jpg", "image/jpeg"],
    ["image/png; charset=binary", "products/item.png", "image/png"],
    ["video/mp4", "consultant/item.mp4", "video/mp4"],
    ["video/quicktime", "consultant/item.mov", "video/quicktime"],
    ["application/octet-stream", "consultant/item.mp4", "video/mp4"],
    [null, "consultant/item.mov", "video/quicktime"],
    [null, "products/item.webp", "image/webp"],
    ["image/svg+xml", "products/item.svg", null],
    ["application/pdf", "products/item.pdf", null],
  ] as const)("%s %s => %s", (contentType, path, expected) => {
    expect(publicMediaContentType(contentType, path)).toBe(expected);
  });
});
