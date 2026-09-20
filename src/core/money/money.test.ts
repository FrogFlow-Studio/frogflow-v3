import { describe, expect, it } from "vitest";
import { convertViaUsd, formatMoney, manualCountryPrice } from "./money";

describe("money", () => {
  it("formatMoney: тенге со знаком, остальные с кодом, дроби до двух знаков", () => {
    expect(formatMoney(1000, "KZT")).toBe("1000 ₸");
    expect(formatMoney("12.5", "USD")).toBe("12.50 USD");
    expect(formatMoney(7, "rub")).toBe("7 rub");
    expect(formatMoney("abc", "KZT")).toBe("abc ₸");
  });

  it("manualCountryPrice: плоская карта, старый вид, мусор", () => {
    expect(manualCountryPrice({ KZ: 600 }, "KZ")).toBe(600);
    expect(manualCountryPrice({ KZ: { price: 500, currency: "KZT" } }, "KZ")).toBe(500);
    expect(manualCountryPrice({ KZ: 0 }, "KZ")).toBeNull();
    expect(manualCountryPrice({ KZ: "x" }, "KZ")).toBeNull();
    expect(manualCountryPrice([1, 2], "KZ")).toBeNull();
    expect(manualCountryPrice(null, "KZ")).toBeNull();
  });

  it("convertViaUsd: через доллар, округление, отсутствие курса — null", () => {
    const rates = { USD: 1, KZT: 500, RUB: 90 };
    expect(convertViaUsd(1000, "KZT", "RUB", rates)).toBe(180);
    expect(convertViaUsd(1000, "KZT", "KZT", rates)).toBe(1000);
    expect(convertViaUsd(1000, "KZT", "EUR", rates)).toBeNull();
  });
});
