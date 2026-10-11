import { describe, expect, it } from "vitest";
import { rowsInBase, shopFxFromRates, toBase } from "./shop-fx";

// 1 $ = 500 ₸ = 80 ₽ = 3,3 BYN.
const fx = shopFxFromRates("kzt", { USD: 1, KZT: 500, RUB: 80, BYN: 3.3 });

describe("пересчёт в валюту магазина", () => {
  it("коэффициент: своя валюта и заказ без валюты — 1, чужая — по курсу, без курса — null", () => {
    expect(fx.base).toBe("KZT");
    expect(fx.factor("KZT")).toBe(1);
    expect(fx.factor(null)).toBe(1);
    expect(fx.factor("rub")).toBe(6.25);
    expect(fx.factor("UZS")).toBeNull();
    expect(shopFxFromRates("KZT", null).factor("RUB")).toBeNull();
  });

  it("сумма: с курсом — в ₸ до тиынов, без курса — в своей валюте", () => {
    expect(toBase(fx, 800, "RUB")).toEqual({ amount: 5000, currency: "KZT" });
    expect(toBase(fx, 65, "BYN")).toEqual({ amount: 9848.48, currency: "KZT" });
    expect(toBase(fx, 26379, "UZS")).toEqual({ amount: 26379, currency: "UZS" });
  });

  it("строки заказов и возвраты: total, задаток и возврат по курсу, строки без курса не меняются", () => {
    const { rows, refunds } = rowsInBase(
      fx,
      [
        { id: 1, total: 1000, paid_amount: null, currency: "KZT" },
        { id: 2, total: 800, paid_amount: 160, currency: "RUB" },
        { id: 3, total: 100, paid_amount: null, currency: "UZS" },
      ],
      new Map([
        [2, 80],
        [3, 10],
      ]),
    );
    expect(rows).toEqual([
      { id: 1, total: 1000, paid_amount: null, currency: "KZT" },
      { id: 2, total: 5000, paid_amount: 1000, currency: "KZT" },
      { id: 3, total: 100, paid_amount: null, currency: "UZS" },
    ]);
    expect(refunds).toEqual(
      new Map([
        [2, 500],
        [3, 10],
      ]),
    );
  });
});
