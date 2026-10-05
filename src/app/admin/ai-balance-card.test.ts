import { describe, expect, it } from "vitest";
import { aiBalanceLevel, aiUsdText } from "./ai-balance-card";

describe("карточка ИИ-баланса на главной", () => {
  it("пороги те же, что на странице баланса", () => {
    expect(aiBalanceLevel(5, false)).toBe("ok");
    expect(aiBalanceLevel(5, true)).toBe("ok");
    expect(aiBalanceLevel(0.5, true)).toBe("low");
    expect(aiBalanceLevel(0, true)).toBe("empty");
    expect(aiBalanceLevel(-1, true)).toBe("empty");
    // стартовые ещё не начислены — не «закончился»
    expect(aiBalanceLevel(0, false)).toBe("ok");
  });
  it("сумма с долларом и знаком", () => {
    expect(aiUsdText(5)).toBe("$5.00");
    expect(aiUsdText(-1.5)).toBe("−$1.50");
  });
});
