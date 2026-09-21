import { describe, expect, it } from "vitest";
import { formatRatingSummary, isValidRating, starsForRating } from "./pure";

describe("reviews/pure", () => {
  it("оценка — целое от 1 до 5", () => {
    expect(isValidRating(3)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(2.5)).toBe(false);
  });
  it("звёзды и сводка", () => {
    expect(starsForRating(4)).toBe("⭐⭐⭐⭐☆");
    expect(starsForRating(9)).toBe("⭐⭐⭐⭐⭐");
    expect(formatRatingSummary(4.46, 12)).toBe("⭐ 4.5 (12)");
    expect(formatRatingSummary(null, 0)).toBeNull();
    expect(formatRatingSummary(5, 0)).toBeNull();
  });
});
