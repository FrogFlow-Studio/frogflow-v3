import { describe, expect, it } from "vitest";
import { convertViaUsd, formatMoney, manualCountryPrice } from "./money";

describe("money", () => {
  it("formatMoney: тенге и рубль со знаком, остальные с кодом, дроби до двух знаков", () => {
    expect(formatMoney(1000, "KZT")).toBe("1000 ₸");
    expect(formatMoney("12.5", "USD")).toBe("12.50 USD");
    expect(formatMoney(7, "rub")).toBe("7 ₽");
    expect(formatMoney(4900, "RUB")).toBe("4900 ₽");
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

describe("formatMoneyUi", () => {
  it("разряды неразрывным пробелом, знак валюты не отрывается", async () => {
    const { formatMoneyUi } = await import("./money");
    expect(formatMoneyUi(12500, "KZT")).toBe("12 500 ₸");
    expect(formatMoneyUi(1250000, "RUB")).toBe("1 250 000 ₽");
    expect(formatMoneyUi(999, "KZT")).toBe("999 ₸");
    expect(formatMoneyUi(-4500, "KZT")).toBe("-4 500 ₸");
    expect(formatMoneyUi(1234.5, "USD")).toBe("1 234.50 USD");
    expect(formatMoneyUi("abc", "KZT")).toBe("abc ₸");
  });
  it("бот и письма без изменений", async () => {
    const { formatMoney } = await import("./money");
    expect(formatMoney(12500, "KZT")).toBe("12500 ₸");
  });
});
