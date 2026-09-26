import { describe, expect, it } from "vitest";
import { parseStarsPayload, parseStarsRate, starsFor, starsPayload } from "./stars";

describe("Telegram Stars", () => {
  it("курс: положительное число, запятая допустима", () => {
    expect(parseStarsRate("6,5")).toBe(6.5);
    expect(parseStarsRate("0")).toBeNull();
    expect(parseStarsRate("abc")).toBeNull();
    expect(parseStarsRate(null)).toBeNull();
  });
  it("звёзды округляются вверх, минимум одна", () => {
    expect(starsFor(1300, 6.5)).toBe(200);
    expect(starsFor(1301, 6.5)).toBe(201);
    expect(starsFor(1, 6.5)).toBe(1);
  });
  it("payload заказа туда и обратно, чужой — null", () => {
    expect(parseStarsPayload(starsPayload(42))).toBe(42);
    expect(parseStarsPayload("vip:1")).toBeNull();
    expect(parseStarsPayload("order:-3")).toBeNull();
  });
});
