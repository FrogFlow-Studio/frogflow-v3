import { describe, expect, it } from "vitest";
import { formatCount, parseCount } from "./motion";

describe("счётчики главной", () => {
  it("разбирает число с разделителем групп и хвостом", () => {
    expect(parseCount("2 500+")).toEqual({ n: 2500, sep: " ", tail: "+" });
    expect(parseCount("2 300+")).toEqual({ n: 2300, sep: " ", tail: "+" });
    expect(parseCount("7")).toEqual({ n: 7, sep: " ", tail: "" });
    expect(parseCount("Новый")).toBeNull();
  });
  it("собирает число обратно тем же разделителем", () => {
    expect(formatCount(2500, " ")).toBe("2 500");
    expect(formatCount(1249.6, " ")).toBe("1 250");
    expect(formatCount(590, " ")).toBe("590");
  });
});
